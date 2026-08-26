import { describe, expect, it } from 'vitest';
import {
  divideRound,
  formatMinorUnits,
  parseDecimal,
  rescale,
  type RoundingMode,
} from './decimal';

describe('parseDecimal', () => {
  it('parses integers without a fraction', () => {
    expect(parseDecimal('125')).toEqual({
      ok: true,
      value: { units: 125n, scale: 0 },
    });
  });

  it('preserves the exact significant digits and scale of the input', () => {
    expect(parseDecimal('125.37')).toEqual({
      ok: true,
      value: { units: 12537n, scale: 2 },
    });
  });

  it('preserves trailing zeros as scale rather than discarding them', () => {
    // `1.10` and `1.1` are the same value but different precision. Keeping the
    // distinction matters when a source system's precision is itself evidence.
    expect(parseDecimal('1.10')).toEqual({
      ok: true,
      value: { units: 110n, scale: 2 },
    });
    expect(parseDecimal('1.1')).toEqual({
      ok: true,
      value: { units: 11n, scale: 1 },
    });
  });

  it('handles negative and explicitly positive signs', () => {
    expect(parseDecimal('-42.50')).toEqual({
      ok: true,
      value: { units: -4250n, scale: 2 },
    });
    expect(parseDecimal('+42.50')).toEqual({
      ok: true,
      value: { units: 4250n, scale: 2 },
    });
  });

  it('normalizes negative zero', () => {
    expect(parseDecimal('-0.00')).toEqual({
      ok: true,
      value: { units: 0n, scale: 2 },
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseDecimal('  10.00  ')).toEqual({
      ok: true,
      value: { units: 1000n, scale: 2 },
    });
  });

  it('parses values far beyond IEEE-754 safe integer range exactly', () => {
    const result = parseDecimal('99999999999999999.99');
    expect(result).toEqual({
      ok: true,
      value: { units: 9999999999999999999n, scale: 2 },
    });
  });

  it('rejects an empty or whitespace-only string', () => {
    expect(parseDecimal('')).toEqual({ ok: false, error: { kind: 'empty' } });
    expect(parseDecimal('   ')).toEqual({
      ok: false,
      error: { kind: 'empty' },
    });
  });

  it.each([
    ['abc', 'non-numeric'],
    ['1e3', 'exponential notation'],
    ['1E3', 'uppercase exponential'],
    ['1,234.56', 'thousands separator'],
    ['.5', 'bare fraction'],
    ['5.', 'trailing decimal point'],
    ['1.2.3', 'multiple decimal points'],
    ['--5', 'double sign'],
    ['5-', 'trailing sign'],
    ['NaN', 'NaN literal'],
    ['Infinity', 'Infinity literal'],
    ['0x10', 'hexadecimal'],
    ['1 000', 'internal whitespace'],
    ['١٢٣', 'non-ASCII digits'],
  ])('rejects %s (%s)', (input) => {
    expect(parseDecimal(input)).toEqual({
      ok: false,
      error: { kind: 'malformed', received: input },
    });
  });

  it('rejects input exceeding the digit bound', () => {
    const result = parseDecimal('1'.repeat(26));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('too-many-digits');
    }
  });

  it('accepts input exactly at the digit bound', () => {
    expect(parseDecimal('1'.repeat(25)).ok).toBe(true);
  });
});

describe('divideRound', () => {
  it('returns an exact quotient when there is no remainder', () => {
    for (const mode of [
      'half-up',
      'half-down',
      'half-even',
      'up',
      'down',
      'ceiling',
      'floor',
    ] satisfies RoundingMode[]) {
      expect(divideRound(100n, 4n, mode)).toBe(25n);
      expect(divideRound(-100n, 4n, mode)).toBe(-25n);
    }
  });

  describe('exact-tie behavior (the boundary every mode disagrees on)', () => {
    // 5/10 is exactly 0.5 — the case that distinguishes the rounding modes.
    it.each([
      ['half-up', 1n],
      ['half-down', 0n],
      ['half-even', 0n], // 0 is even, so the tie stays put
      ['up', 1n],
      ['down', 0n],
      ['ceiling', 1n],
      ['floor', 0n],
    ] satisfies [RoundingMode, bigint][])('%s rounds 0.5 to %s', (mode, expected) => {
      expect(divideRound(5n, 10n, mode)).toBe(expected);
    });

    it.each([
      ['half-up', 2n],
      ['half-down', 1n],
      ['half-even', 2n], // 2 is even, so the tie rounds up to it
      ['up', 2n],
      ['down', 1n],
      ['ceiling', 2n],
      ['floor', 1n],
    ] satisfies [RoundingMode, bigint][])('%s rounds 1.5 to %s', (mode, expected) => {
      expect(divideRound(15n, 10n, mode)).toBe(expected);
    });

    it.each([
      ['half-up', 3n],
      ['half-down', 2n],
      ['half-even', 2n], // 2 is even, so the tie rounds down to it
      ['up', 3n],
      ['down', 2n],
      ['ceiling', 3n],
      ['floor', 2n],
    ] satisfies [RoundingMode, bigint][])('%s rounds 2.5 to %s', (mode, expected) => {
      expect(divideRound(25n, 10n, mode)).toBe(expected);
    });
  });

  describe('negative values', () => {
    it('treats half-up as "away from zero", mirroring positive values', () => {
      // Symmetry matters: a recoupment must be the exact mirror of the payment
      // it reverses, or reversals will not net to zero.
      expect(divideRound(-5n, 10n, 'half-up')).toBe(-1n);
      expect(divideRound(5n, 10n, 'half-up')).toBe(1n);
    });

    it('distinguishes floor/ceiling from down/up on negatives', () => {
      expect(divideRound(-7n, 10n, 'down')).toBe(0n); // toward zero
      expect(divideRound(-7n, 10n, 'floor')).toBe(-1n); // toward -infinity
      expect(divideRound(-7n, 10n, 'up')).toBe(-1n); // away from zero
      expect(divideRound(-7n, 10n, 'ceiling')).toBe(0n); // toward +infinity
    });

    it('applies half-even symmetrically', () => {
      expect(divideRound(-15n, 10n, 'half-even')).toBe(-2n);
      expect(divideRound(-25n, 10n, 'half-even')).toBe(-2n);
    });
  });

  it('rejects a non-positive divisor as a programmer error', () => {
    expect(() => divideRound(10n, 0n, 'half-up')).toThrow(RangeError);
    expect(() => divideRound(10n, -2n, 'half-up')).toThrow(RangeError);
  });

  it('never drifts by more than one unit from the true quotient', () => {
    // Exhaustive over a small space: catches any mode that mis-handles the
    // magnitude/sign split.
    const modes: RoundingMode[] = [
      'half-up',
      'half-down',
      'half-even',
      'up',
      'down',
      'ceiling',
      'floor',
    ];
    for (let dividend = -50n; dividend <= 50n; dividend++) {
      for (let divisor = 1n; divisor <= 12n; divisor++) {
        for (const mode of modes) {
          const rounded = divideRound(dividend, divisor, mode);
          const scaledError = rounded * divisor - dividend;
          const magnitude = scaledError < 0n ? -scaledError : scaledError;
          expect(magnitude).toBeLessThan(divisor);
        }
      }
    }
  });
});

describe('rescale', () => {
  it('is exact when scaling up', () => {
    expect(rescale({ units: 15n, scale: 1 }, 4, 'half-up')).toBe(15000n);
  });

  it('is identity at the same scale', () => {
    expect(rescale({ units: 1234n, scale: 2 }, 2, 'half-up')).toBe(1234n);
  });

  it('applies the supplied mode when scaling down', () => {
    expect(rescale({ units: 1005n, scale: 3 }, 2, 'half-up')).toBe(101n);
    expect(rescale({ units: 1005n, scale: 3 }, 2, 'down')).toBe(100n);
    expect(rescale({ units: 1005n, scale: 3 }, 2, 'half-even')).toBe(100n);
  });
});

describe('formatMinorUnits', () => {
  it.each([
    [12537n, 2, '125.37'],
    [0n, 2, '0.00'],
    [5n, 2, '0.05'],
    [50n, 2, '0.50'],
    [-12537n, 2, '-125.37'],
    [-5n, 2, '-0.05'],
    [1200n, 0, '1200'],
    [0n, 0, '0'],
    [-1200n, 0, '-1200'],
    [1n, 3, '0.001'],
  ])('renders %s at scale %s as %s', (units, scale, expected) => {
    expect(formatMinorUnits(units, scale)).toBe(expected);
  });

  it('always emits the full fraction width so output is byte-stable', () => {
    // Byte stability is what makes a serialized amount safe to hash or diff in
    // an audit record.
    expect(formatMinorUnits(100n, 2)).toBe('1.00');
    expect(formatMinorUnits(110n, 2)).toBe('1.10');
  });

  it('round-trips exactly through parseDecimal', () => {
    for (const units of [0n, 1n, -1n, 99n, -12537n, 100000000000n]) {
      const formatted = formatMinorUnits(units, 2);
      const parsed = parseDecimal(formatted);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(rescale(parsed.value, 2, 'half-up')).toBe(units);
      }
    }
  });
});
