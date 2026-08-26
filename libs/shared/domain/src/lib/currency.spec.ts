import { describe, expect, it } from 'vitest';
import { currencyOf, minorUnits, parseCurrencyCode, CURRENCIES } from './currency';
import { isErr, isOk } from './result';

describe('currency registry', () => {
  it('exposes the ISO 4217 minor-unit exponent', () => {
    expect(currencyOf('USD').exponent).toBe(2);
    expect(currencyOf('EUR').exponent).toBe(2);
  });

  it('models a zero-exponent currency correctly', () => {
    // JPY has no minor unit. Hardcoding "cents" anywhere would be a 100x error.
    expect(currencyOf('JPY').exponent).toBe(0);
    expect(currencyOf('JPY').scale).toBe(1n);
  });

  it('precomputes the scale factor as an exact bigint', () => {
    expect(currencyOf('USD').scale).toBe(100n);
  });

  it('is frozen against mutation', () => {
    // Currency metadata is not configuration. Mutating it would retroactively
    // change the meaning of every stored amount.
    expect(Object.isFrozen(CURRENCIES)).toBe(true);
  });
});

describe('parseCurrencyCode', () => {
  it('accepts a supported code', () => {
    const result = parseCurrencyCode('USD');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe('USD');
    }
  });

  it('normalizes case and whitespace', () => {
    const result = parseCurrencyCode('  usd  ');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe('USD');
    }
  });

  it('rejects an unsupported code', () => {
    const result = parseCurrencyCode('XYZ');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toEqual({
        kind: 'unsupported-currency',
        received: 'XYZ',
      });
    }
  });

  it('rejects prototype-chain property names', () => {
    // A naive `REGISTRY[candidate]` lookup would resolve these to functions.
    for (const hostile of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(isErr(parseCurrencyCode(hostile))).toBe(true);
    }
  });

  it('rejects an empty string', () => {
    expect(isErr(parseCurrencyCode(''))).toBe(true);
  });
});

describe('MinorUnits brand', () => {
  it('is a plain bigint at runtime', () => {
    expect(typeof minorUnits(12537n)).toBe('bigint');
    expect(minorUnits(12537n)).toBe(12537n);
  });

  it('permits negative values for recoupments and reversals', () => {
    expect(minorUnits(-12537n)).toBe(-12537n);
  });
});
