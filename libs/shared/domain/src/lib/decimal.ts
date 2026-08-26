/**
 * Exact decimal string parsing and integer rounding.
 *
 * This module is the reason Zenith Pulse needs no arbitrary-precision decimal
 * library. Money is stored as a `bigint` count of minor units, so addition and
 * subtraction are exact by construction. The only places rounding can occur are
 * multiplication by a rate and division — and both are handled here with an
 * explicitly supplied rounding mode, so no rounding ever happens implicitly or
 * via ambient global configuration.
 */

/**
 * Explicit rounding modes.
 *
 * There is deliberately no default. In healthcare finance the rounding mode is
 * a business decision that varies by context (payer contract terms, coinsurance
 * calculation, sequestration reduction), so every call site is required to
 * state its intent. Silent defaults are how systems end up a cent apart from a
 * remittance advice with nobody able to explain why.
 */
export type RoundingMode =
  /** Ties away from zero. Most common in US healthcare contract math. */
  | 'half-up'
  /** Ties toward zero. */
  | 'half-down'
  /** Ties to the nearest even value ("banker's rounding"). Reduces bias. */
  | 'half-even'
  /** Always away from zero. */
  | 'up'
  /** Always toward zero (truncation). */
  | 'down'
  /** Toward +infinity. */
  | 'ceiling'
  /** Toward -infinity. */
  | 'floor';

/**
 * Upper bound on input digits.
 *
 * Guards against pathological input (a megabyte of digits) reaching `BigInt`,
 * where parsing and subsequent arithmetic cost grows superlinearly. 25 digits
 * comfortably exceeds any real monetary value while keeping the boundary cheap.
 */
const MAX_DIGITS = 25;

/**
 * Strict decimal grammar: optional sign, integer digits, optional fraction.
 *
 * Intentionally rejects exponential notation (`1e3`), thousands separators
 * (`1,234.56`), bare fractions (`.5`), trailing points (`5.`), and any
 * whitespace beyond the outer trim. Normalizing those variants is the job of an
 * input adapter that can attribute the problem to a specific source field, not
 * of the financial core.
 */
const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;

export type DecimalParseError =
  | { readonly kind: 'empty' }
  | { readonly kind: 'malformed'; readonly received: string }
  | {
      readonly kind: 'too-many-digits';
      readonly received: string;
      readonly maxDigits: number;
    };

/**
 * A decimal number represented exactly as `units * 10^-scale`.
 *
 * `1.05` becomes `{ units: 105n, scale: 2 }`. The representation is lossless:
 * the significant digits of the input are preserved verbatim, never routed
 * through an IEEE-754 double.
 */
export interface ParsedDecimal {
  readonly units: bigint;
  readonly scale: number;
}

export function parseDecimal(
  raw: string,
): { ok: true; value: ParsedDecimal } | { ok: false; error: DecimalParseError } {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { ok: false, error: { kind: 'empty' } };
  }

  const match = DECIMAL_PATTERN.exec(trimmed);
  if (match === null) {
    return { ok: false, error: { kind: 'malformed', received: raw } };
  }

  const sign = match[1] === '-' ? '-' : '';
  const integerPart = match[2] ?? '';
  const fractionPart = match[3] ?? '';

  if (integerPart.length + fractionPart.length > MAX_DIGITS) {
    return {
      ok: false,
      error: { kind: 'too-many-digits', received: raw, maxDigits: MAX_DIGITS },
    };
  }

  // `BigInt('-0')` is `0n`, so negative zero normalizes away for free.
  return {
    ok: true,
    value: {
      units: BigInt(`${sign}${integerPart}${fractionPart}`),
      scale: fractionPart.length,
    },
  };
}

/**
 * Rescales an exact decimal to a target scale.
 *
 * Scaling up is exact. Scaling down applies `mode`. Returns the integer count
 * of units at `targetScale`.
 */
export function rescale(
  decimal: ParsedDecimal,
  targetScale: number,
  mode: RoundingMode,
): bigint {
  if (targetScale === decimal.scale) {
    return decimal.units;
  }
  if (targetScale > decimal.scale) {
    return decimal.units * 10n ** BigInt(targetScale - decimal.scale);
  }
  return divideRound(decimal.units, 10n ** BigInt(decimal.scale - targetScale), mode);
}

/**
 * Divides two integers, applying `mode` to the remainder.
 *
 * `divisor` must be strictly positive; callers normalize sign into the dividend.
 * Rounding is performed on the magnitude and the sign reapplied, which keeps
 * `half-up` meaning "away from zero" symmetrically for negative amounts — the
 * behavior needed for recoupments and reversals to mirror the payments they undo.
 */
export function divideRound(
  dividend: bigint,
  divisor: bigint,
  mode: RoundingMode,
): bigint {
  if (divisor <= 0n) {
    // A programmer error, not bad input: no domain path should produce this.
    throw new RangeError(`divideRound requires a positive divisor, got ${divisor}`);
  }

  const negative = dividend < 0n;
  const magnitude = negative ? -dividend : dividend;
  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;

  if (remainder === 0n) {
    return negative ? -quotient : quotient;
  }

  const twiceRemainder = remainder * 2n;
  let rounded: bigint;

  switch (mode) {
    case 'down':
      rounded = quotient;
      break;
    case 'up':
      rounded = quotient + 1n;
      break;
    case 'floor':
      rounded = negative ? quotient + 1n : quotient;
      break;
    case 'ceiling':
      rounded = negative ? quotient : quotient + 1n;
      break;
    case 'half-up':
      rounded = twiceRemainder >= divisor ? quotient + 1n : quotient;
      break;
    case 'half-down':
      rounded = twiceRemainder > divisor ? quotient + 1n : quotient;
      break;
    case 'half-even':
      if (twiceRemainder > divisor) {
        rounded = quotient + 1n;
      } else if (twiceRemainder < divisor) {
        rounded = quotient;
      } else {
        rounded = quotient % 2n === 0n ? quotient : quotient + 1n;
      }
      break;
  }

  return negative ? -rounded : rounded;
}

/**
 * Renders an integer count of minor units as a canonical decimal string.
 *
 * Always emits exactly `scale` fraction digits (`0` -> `"0.00"` at scale 2) so
 * that serialized values are byte-stable and safe to compare, hash, or diff in
 * an audit trail.
 */
export function formatMinorUnits(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString();

  if (scale === 0) {
    return `${negative ? '-' : ''}${digits}`;
  }

  const padded = digits.padStart(scale + 1, '0');
  const boundary = padded.length - scale;
  return `${negative ? '-' : ''}${padded.slice(0, boundary)}.${padded.slice(boundary)}`;
}
