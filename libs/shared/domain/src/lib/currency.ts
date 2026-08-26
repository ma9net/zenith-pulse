import type { Brand } from './brand';
import { err, ok, type Result } from './result';

/**
 * ISO 4217 alphabetic currency code.
 *
 * Deliberately a closed union rather than an open `string`. Zenith Pulse does
 * not perform currency conversion (out of MVP scope) but currency *identity*
 * must exist so that adding EUR to USD is a compile error rather than a silent
 * financial defect.
 *
 * JPY is included specifically to keep the model honest: it has a minor-unit
 * exponent of 0, which prevents anyone from assuming "cents" means "hundredths"
 * throughout the codebase. Getting this wrong is a 100x error, not a rounding
 * error.
 */
export type CurrencyCode = 'USD' | 'CAD' | 'EUR' | 'GBP' | 'AED' | 'JPY';

export interface Currency {
  readonly code: CurrencyCode;
  /** ISO 4217 minor-unit exponent: USD=2 (cents), JPY=0, BHD=3 (fils). */
  readonly exponent: number;
  /** Scale factor, i.e. 10^exponent. Precomputed as a bigint for exact math. */
  readonly scale: bigint;
  readonly symbol: string;
}

const define = (
  code: CurrencyCode,
  exponent: number,
  symbol: string,
): Currency => ({
  code,
  exponent,
  scale: 10n ** BigInt(exponent),
  symbol,
});

const REGISTRY: Readonly<Record<CurrencyCode, Currency>> = Object.freeze({
  USD: define('USD', 2, '$'),
  CAD: define('CAD', 2, 'CA$'),
  EUR: define('EUR', 2, '€'),
  GBP: define('GBP', 2, '£'),
  AED: define('AED', 2, 'د.إ'),
  JPY: define('JPY', 0, '¥'),
});

export const CURRENCIES = REGISTRY;

export function currencyOf(code: CurrencyCode): Currency {
  return REGISTRY[code];
}

export type CurrencyCodeError = {
  readonly kind: 'unsupported-currency';
  readonly received: string;
};

/**
 * Validates an untrusted string as a supported currency code.
 *
 * Use at every I/O boundary (mock API, future X12/FHIR adapters). Inside the
 * domain, rely on the `CurrencyCode` type instead.
 */
export function parseCurrencyCode(
  raw: string,
): Result<CurrencyCode, CurrencyCodeError> {
  const candidate = raw.trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(REGISTRY, candidate)) {
    return ok(candidate as CurrencyCode);
  }
  return err({ kind: 'unsupported-currency', received: raw });
}

/**
 * Signed count of a currency's smallest indivisible unit.
 *
 * Branded so that a bare `bigint` (a unit count, a line sequence, an ID) can
 * never be passed where minor units are expected. Signed because RCM is full of
 * legitimately negative amounts: recoupments, take-backs, refunds, reversals,
 * and credit adjustments. A non-negative money type would be wrong for this
 * domain — see `Money`'s documented stance on negatives.
 */
export type MinorUnits = Brand<bigint, 'MinorUnits'>;

export const minorUnits = (value: bigint): MinorUnits => value as MinorUnits;
