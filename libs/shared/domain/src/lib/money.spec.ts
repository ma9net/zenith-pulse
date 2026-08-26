import { describe, expect, it } from 'vitest';
import { Money, usd, type MoneyError } from './money';
import { expect as unwrap, isErr, isOk, type Result } from './result';

/** Unwraps a `Result` in tests, failing loudly with the domain error on Err. */
const money = <C extends 'USD' | 'EUR' | 'JPY'>(
  result: Result<Money<C>, MoneyError>,
): Money<C> => unwrap(result, 'expected valid Money');

const dollars = (decimal: string) => money(usd(decimal));

/**
 * Deterministic pseudo-random generator (mulberry32).
 *
 * Property tests need randomized inputs but reproducible failures. A seeded
 * generator gives both in ~8 lines, without adding a dependency — consistent
 * with keeping the library surface small. Every run of this suite explores the
 * same inputs, so a failure is always replayable.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Money construction', () => {
  it('builds from an exact count of minor units', () => {
    const amount = Money.fromMinorUnits(12537n, 'USD');
    expect(amount.minorUnits).toBe(12537n);
    expect(amount.toDecimalString()).toBe('125.37');
  });

  it('parses a decimal string into minor units', () => {
    expect(dollars('125.37').minorUnits).toBe(12537n);
    expect(dollars('125').minorUnits).toBe(12500n);
    expect(dollars('125.3').minorUnits).toBe(12530n);
    expect(dollars('0.01').minorUnits).toBe(1n);
  });

  it('respects the currency exponent when parsing', () => {
    // JPY has no minor unit. Assuming "cents" everywhere would be a 100x error.
    expect(money(Money.parse('1200', 'JPY')).minorUnits).toBe(1200n);
    expect(money(Money.parse('1200', 'USD')).minorUnits).toBe(120000n);
  });

  it('creates a denominated zero', () => {
    const zero = Money.zero('USD');
    expect(zero.isZero()).toBe(true);
    expect(zero.toDecimalString()).toBe('0.00');
  });

  it('is immutable and frozen', () => {
    const amount = dollars('10.00');
    expect(Object.isFrozen(amount)).toBe(true);
    expect(amount.add(dollars('5.00')).minorUnits).toBe(1500n);
    expect(amount.minorUnits).toBe(1000n); // original untouched
  });

  describe('precision guarantees', () => {
    it('does not lose precision on the classic float case', () => {
      const sum = dollars('0.10').add(dollars('0.20'));
      expect(sum.minorUnits).toBe(30n);
      expect(sum.toDecimalString()).toBe('0.30');
      // Contrast: 0.1 + 0.2 === 0.30000000000000004 in IEEE-754.
      expect(0.1 + 0.2).not.toBe(0.3);
    });

    it('stays exact well beyond Number.MAX_SAFE_INTEGER', () => {
      const huge = Money.fromMinorUnits(9007199254740993n, 'USD');
      expect(huge.add(Money.fromMinorUnits(1n, 'USD')).minorUnits).toBe(
        9007199254740994n,
      );
    });

    it('accepts no numeric overload, so float error cannot enter', () => {
      // Compile-time guarantee. The assertion lives in a never-invoked function
      // so that `@ts-expect-error` documents the type error without the call
      // actually running — `tsc` still checks the body.
      const _typeOnly = () => {
        // @ts-expect-error parse only accepts a string, never a number
        Money.parse(0.1, 'USD');
        // @ts-expect-error parseWithRounding likewise rejects a number
        Money.parseWithRounding(0.1, 'USD', 'half-up');
      };
      expect(typeof _typeOnly).toBe('function');
    });
  });

  describe('input validation', () => {
    it('rejects excess precision rather than silently rounding', () => {
      // A half-cent is either a data-quality problem or a decision that needs
      // to be made explicitly. Guessing hides the discrepancy.
      const result = usd('10.005');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toEqual({
          kind: 'excess-precision',
          received: '10.005',
          currency: 'USD',
          maxFractionDigits: 2,
        });
      }
    });

    it('rejects any fraction for a zero-exponent currency', () => {
      expect(isErr(Money.parse('1200.5', 'JPY'))).toBe(true);
    });

    it.each(['', '   ', 'abc', '1e3', '1,234.56', '.5', '5.', 'NaN', 'Infinity'])(
      'rejects %s',
      (input) => {
        expect(isErr(usd(input))).toBe(true);
      },
    );

    it('never throws on malformed input; it returns an inspectable error', () => {
      expect(() => usd('not-a-number')).not.toThrow();
    });

    it('rounds only when rounding is explicitly requested', () => {
      expect(
        money(Money.parseWithRounding('10.005', 'USD', 'half-up')).minorUnits,
      ).toBe(1001n);
      expect(
        money(Money.parseWithRounding('10.005', 'USD', 'down')).minorUnits,
      ).toBe(1000n);
      expect(
        money(Money.parseWithRounding('10.005', 'USD', 'half-even')).minorUnits,
      ).toBe(1000n);
    });
  });
});

describe('Money exact arithmetic', () => {
  it('adds and subtracts', () => {
    expect(dollars('125.37').add(dollars('74.63')).toDecimalString()).toBe('200.00');
    expect(dollars('125.37').subtract(dollars('25.37')).toDecimalString()).toBe('100.00');
  });

  it('produces negative results for over-subtraction', () => {
    // Legitimate in RCM: recoupments, take-backs, reversals, credit balances.
    const result = dollars('50.00').subtract(dollars('75.00'));
    expect(result.toDecimalString()).toBe('-25.00');
    expect(result.isNegative()).toBe(true);
  });

  it('negates and takes absolute value', () => {
    expect(dollars('25.00').negate().toDecimalString()).toBe('-25.00');
    expect(dollars('25.00').negate().absolute().toDecimalString()).toBe('25.00');
    expect(dollars('25.00').absolute().toDecimalString()).toBe('25.00');
  });

  it('reports sign correctly', () => {
    expect(dollars('1.00').signum()).toBe(1);
    expect(dollars('0.00').signum()).toBe(0);
    expect(dollars('1.00').negate().signum()).toBe(-1);
  });

  it('sums a collection', () => {
    const lines = [dollars('10.01'), dollars('20.02'), dollars('30.03')];
    expect(Money.sum(lines, 'USD').toDecimalString()).toBe('60.06');
  });

  it('sums an empty collection to a typed zero', () => {
    // An empty line set is ordinary; inferring currency from lines[0] would throw.
    expect(Money.sum([], 'USD').toDecimalString()).toBe('0.00');
  });

  it('multiplies by an integer unit count exactly', () => {
    // Service line: 3 units at $45.50.
    expect(dollars('45.50').multiplyByUnits(3n).toDecimalString()).toBe('136.50');
  });

  describe('algebraic properties', () => {
    const random = seeded(0x5eed);
    const sample = (): Money<'USD'> =>
      Money.fromMinorUnits(
        BigInt(Math.floor(random() * 4_000_000) - 2_000_000),
        'USD',
      );

    it('addition is commutative and associative over 500 random triples', () => {
      for (let i = 0; i < 500; i++) {
        const [a, b, c] = [sample(), sample(), sample()];
        expect(a.add(b).equals(b.add(a))).toBe(true);
        expect(a.add(b).add(c).equals(a.add(b.add(c)))).toBe(true);
      }
    });

    it('subtraction is the inverse of addition over 500 random pairs', () => {
      for (let i = 0; i < 500; i++) {
        const [a, b] = [sample(), sample()];
        expect(a.add(b).subtract(b).equals(a)).toBe(true);
      }
    });

    it('zero is the additive identity, and negation its inverse', () => {
      for (let i = 0; i < 500; i++) {
        const a = sample();
        expect(a.add(Money.zero('USD')).equals(a)).toBe(true);
        expect(a.add(a.negate()).isZero()).toBe(true);
      }
    });
  });
});

describe('Money currency safety', () => {
  it('rejects cross-currency arithmetic at compile time', () => {
    // The primary currency guarantee is static. Body is never invoked; `tsc`
    // still type-checks it, so this fails the build if the guarantee regresses.
    const _typeOnly = () => {
      const inUsd = dollars('10.00');
      const inEur = money(Money.parse('10.00', 'EUR'));
      // @ts-expect-error Money<'EUR'> is not assignable to Money<'USD'>
      inUsd.add(inEur);
      // @ts-expect-error same for subtraction
      inUsd.subtract(inEur);
      // @ts-expect-error and for ordering
      inUsd.compare(inEur);
      // @ts-expect-error and for a mixed collection
      Money.sum([inUsd, inEur], 'USD');
    };
    expect(typeof _typeOnly).toBe('function');
  });

  it('throws at runtime on type-erased cross-currency addition', () => {
    // Backstop for boundaries where types are lost (JSON, `any`). A crash is
    // strictly better than a silently wrong monetary total.
    const inUsd = dollars('10.00');
    const inEur = money(Money.parse('10.00', 'EUR')) as unknown as Money<'USD'>;
    expect(() => inUsd.add(inEur)).toThrow(TypeError);
    expect(() => inUsd.subtract(inEur)).toThrow(TypeError);
    expect(() => inUsd.compare(inEur)).toThrow(TypeError);
  });

  it('returns a structured error from tryAdd instead of throwing', () => {
    const result = dollars('10.00').tryAdd(money(Money.parse('10.00', 'EUR')));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toEqual({
        kind: 'currency-mismatch',
        left: 'USD',
        right: 'EUR',
      });
    }
  });

  it('succeeds via tryAdd when currencies agree', () => {
    const result = dollars('10.00').tryAdd(dollars('5.00'));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.toDecimalString()).toBe('15.00');
    }
  });

  it('rejects a foreign currency inside sum', () => {
    const mixed = [
      dollars('10.00'),
      money(Money.parse('10.00', 'EUR')) as unknown as Money<'USD'>,
    ];
    expect(() => Money.sum(mixed, 'USD')).toThrow(TypeError);
  });

  it('treats zero in different currencies as unequal', () => {
    expect(Money.zero('USD').equals(Money.zero('EUR'))).toBe(false);
  });

  it('exposes no conversion API', () => {
    // Conversion is out of MVP scope; an unaudited FX rate has no business in
    // the financial core.
    expect('convert' in dollars('1.00')).toBe(false);
  });
});

describe('Money.multiply (rate arithmetic)', () => {
  it('applies a coinsurance percentage', () => {
    // 20% coinsurance on a $150.00 allowed amount.
    expect(
      money(dollars('150.00').multiply('0.20', 'half-up')).toDecimalString(),
    ).toBe('30.00');
  });

  it('applies a contract multiplier', () => {
    expect(
      money(dollars('100.00').multiply('1.025', 'half-up')).toDecimalString(),
    ).toBe('102.50');
  });

  it('applies the 2% sequestration reduction', () => {
    // Medicare sequestration: payment reduced to 98%.
    expect(
      money(dollars('1234.56').multiply('0.98', 'half-up')).toDecimalString(),
    ).toBe('1209.87');
  });

  it('takes the rate as a string so the rate itself is exact', () => {
    // 0.1 is not exactly representable as a double; as a string it is exact.
    expect(
      money(dollars('0.30').multiply('0.1', 'half-up')).toDecimalString(),
    ).toBe('0.03');
  });

  it('requires an explicit rounding mode and honors it', () => {
    // $10.15 * 0.5 = $5.075 — an exact half-cent tie.
    const base = dollars('10.15');
    expect(money(base.multiply('0.5', 'half-up')).toDecimalString()).toBe('5.08');
    expect(money(base.multiply('0.5', 'half-down')).toDecimalString()).toBe('5.07');
    expect(money(base.multiply('0.5', 'half-even')).toDecimalString()).toBe('5.08');
    expect(money(base.multiply('0.5', 'down')).toDecimalString()).toBe('5.07');
    expect(money(base.multiply('0.5', 'up')).toDecimalString()).toBe('5.08');
  });

  it('multiplies by zero and one', () => {
    expect(money(dollars('99.99').multiply('0', 'half-up')).isZero()).toBe(true);
    expect(
      money(dollars('99.99').multiply('1', 'half-up')).toDecimalString(),
    ).toBe('99.99');
  });

  it('rounds negative amounts symmetrically under half-up', () => {
    expect(
      money(dollars('10.15').negate().multiply('0.5', 'half-up')).toDecimalString(),
    ).toBe('-5.08');
  });

  it('returns an error for a malformed rate', () => {
    expect(isErr(dollars('10.00').multiply('abc', 'half-up'))).toBe(true);
    expect(isErr(dollars('10.00').multiply('1e3', 'half-up'))).toBe(true);
  });
});

describe('Money.allocate — penny-perfect distribution', () => {
  it('splits evenly when the amount divides cleanly', () => {
    const parts = dollars('90.00').allocate([1, 1, 1]);
    expect(parts.map((p) => p.toDecimalString())).toEqual([
      '30.00',
      '30.00',
      '30.00',
    ]);
  });

  it('distributes the remainder instead of losing it', () => {
    // The canonical failure: naive 100/3 rounding yields 33.33 x 3 = 99.99 and
    // a claim that no longer balances.
    const parts = dollars('100.00').allocate([1, 1, 1]);
    expect(parts.map((p) => p.toDecimalString())).toEqual([
      '33.34',
      '33.33',
      '33.33',
    ]);
    expect(Money.sum(parts, 'USD').toDecimalString()).toBe('100.00');
  });

  it('allocates by weight', () => {
    // Prorating a $100.00 claim-level adjustment across lines charged 70/30.
    const parts = dollars('100.00').allocate([70, 30]);
    expect(parts.map((p) => p.toDecimalString())).toEqual(['70.00', '30.00']);
  });

  it('allocates by uneven weights without penny loss', () => {
    const total = dollars('0.05');
    const parts = total.allocate([3, 7]);
    expect(parts.map((p) => p.toDecimalString())).toEqual(['0.02', '0.03']);
    expect(Money.sum(parts, 'USD').equals(total)).toBe(true);
  });

  it('never allocates to a zero weight', () => {
    // A line excluded from a proration must stay excluded, even when there is a
    // remainder to distribute.
    const parts = dollars('100.00').allocate([1, 0, 1, 0]);
    expect(parts.map((p) => p.toDecimalString())).toEqual([
      '50.00',
      '0.00',
      '50.00',
      '0.00',
    ]);
  });

  it('mirrors exactly for negative totals', () => {
    // A recoupment must prorate as the precise inverse of the payment it undoes.
    const payment = dollars('100.00').allocate([1, 1, 1]);
    const recoupment = dollars('100.00').negate().allocate([1, 1, 1]);
    recoupment.forEach((part, index) => {
      expect(part.equals((payment[index] as Money<'USD'>).negate())).toBe(true);
    });
    expect(Money.sum(recoupment, 'USD').toDecimalString()).toBe('-100.00');
  });

  it('allocates zero to every share', () => {
    const parts = Money.zero('USD').allocate([1, 2, 3]);
    expect(parts.every((p) => p.isZero())).toBe(true);
  });

  it('handles a single share', () => {
    const parts = dollars('12.34').allocate([1]);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.toDecimalString()).toBe('12.34');
  });

  it('handles an amount smaller than the number of shares', () => {
    const parts = dollars('0.02').allocate([1, 1, 1, 1, 1]);
    expect(parts.map((p) => p.toDecimalString())).toEqual([
      '0.01',
      '0.01',
      '0.00',
      '0.00',
      '0.00',
    ]);
    expect(Money.sum(parts, 'USD').toDecimalString()).toBe('0.02');
  });

  it('is deterministic across repeated calls', () => {
    // Reproducibility is a hard requirement: the same claim must produce the
    // same allocation every time it is evaluated, including on replay.
    const first = dollars('100.00').allocate([1, 1, 1]);
    for (let i = 0; i < 10; i++) {
      const next = dollars('100.00').allocate([1, 1, 1]);
      next.forEach((part, index) =>
        expect(part.equals(first[index] as Money<'USD'>)).toBe(true),
      );
    }
  });

  it('rejects invalid weights', () => {
    expect(() => dollars('10.00').allocate([])).toThrow(RangeError);
    expect(() => dollars('10.00').allocate([0, 0])).toThrow(RangeError);
    expect(() => dollars('10.00').allocate([-1, 2])).toThrow(RangeError);
    expect(() => dollars('10.00').allocate([1.5, 2])).toThrow(RangeError);
  });

  describe('sum-preservation invariant', () => {
    it('holds for 2000 random amount/weight combinations', () => {
      // The single most important property in the class: allocation must never
      // create or destroy money.
      const random = seeded(0xc1a1_1000);
      for (let i = 0; i < 2000; i++) {
        const units = BigInt(Math.floor(random() * 2_000_000) - 1_000_000);
        const total = Money.fromMinorUnits(units, 'USD');
        const count = 1 + Math.floor(random() * 12);
        const drawn: number[] = Array.from({ length: count }, () =>
          Math.floor(random() * 100),
        );
        // allocate() rejects an all-zero weight vector, so guarantee one share.
        const weights: number[] =
          drawn.reduce((sum, w) => sum + w, 0) === 0 ? [1, ...drawn.slice(1)] : drawn;

        const parts = total.allocate(weights);
        expect(parts).toHaveLength(count);
        expect(Money.sum(parts, 'USD').equals(total)).toBe(true);
      }
    });

    it('holds for divide() across 1..25 parts', () => {
      const total = dollars('1000.01');
      for (let parts = 1; parts <= 25; parts++) {
        const shares = total.divide(parts);
        expect(shares).toHaveLength(parts);
        expect(Money.sum(shares, 'USD').equals(total)).toBe(true);
      }
    });

    it('keeps shares within one minor unit of each other for even splits', () => {
      const shares = dollars('100.00').divide(7);
      const values = shares.map((s) => s.minorUnits);
      const min = values.reduce((a, b) => (a < b ? a : b));
      const max = values.reduce((a, b) => (a > b ? a : b));
      expect(max - min).toBeLessThanOrEqual(1n);
    });
  });

  it('rejects a non-positive or non-integer divide count', () => {
    expect(() => dollars('10.00').divide(0)).toThrow(RangeError);
    expect(() => dollars('10.00').divide(-3)).toThrow(RangeError);
    expect(() => dollars('10.00').divide(2.5)).toThrow(RangeError);
  });
});

describe('Money comparison', () => {
  it('compares equal amounts of the same currency', () => {
    expect(dollars('10.00').equals(dollars('10.00'))).toBe(true);
    expect(dollars('10.00').equals(dollars('10.01'))).toBe(false);
  });

  it('is deterministic regardless of construction path', () => {
    expect(
      dollars('10.00').equals(Money.fromMinorUnits(1000n, 'USD')),
    ).toBe(true);
    expect(dollars('10').equals(dollars('10.00'))).toBe(true);
  });

  it('orders amounts', () => {
    const low = dollars('10.00');
    const high = dollars('20.00');
    expect(low.compare(high)).toBe(-1);
    expect(high.compare(low)).toBe(1);
    expect(low.compare(dollars('10.00'))).toBe(0);
    expect(high.greaterThan(low)).toBe(true);
    expect(low.lessThan(high)).toBe(true);
    expect(low.greaterThanOrEqual(dollars('10.00'))).toBe(true);
    expect(low.lessThanOrEqual(dollars('10.00'))).toBe(true);
  });

  it('orders negative amounts correctly', () => {
    expect(dollars('10.00').negate().lessThan(Money.zero('USD'))).toBe(true);
    expect(
      dollars('5.00').negate().greaterThan(dollars('10.00').negate()),
    ).toBe(true);
  });
});

describe('Money serialization', () => {
  it('renders a canonical decimal string with full fraction width', () => {
    expect(dollars('125.37').toDecimalString()).toBe('125.37');
    expect(dollars('125.30').toDecimalString()).toBe('125.30');
    expect(dollars('125').toDecimalString()).toBe('125.00');
    expect(money(Money.parse('1200', 'JPY')).toDecimalString()).toBe('1200');
  });

  it('emits minorUnits as a string, since JSON has no bigint and no exact decimal', () => {
    expect(dollars('125.37').toJSON()).toEqual({
      currency: 'USD',
      minorUnits: '12537',
      decimal: '125.37',
    });
  });

  it('survives JSON.stringify without throwing on bigint', () => {
    expect(() => JSON.stringify(dollars('125.37'))).not.toThrow();
    expect(JSON.parse(JSON.stringify(dollars('125.37')))).toEqual({
      currency: 'USD',
      minorUnits: '12537',
      decimal: '125.37',
    });
  });

  it('round-trips losslessly through JSON', () => {
    for (const input of ['0.00', '0.01', '125.37', '99999999.99']) {
      const original = dollars(input);
      const revived = Money.fromJSON(
        JSON.parse(JSON.stringify(original)) as {
          currency: 'USD';
          minorUnits: string;
        },
      );
      expect(revived.equals(original)).toBe(true);
    }
  });

  it('round-trips negative amounts through JSON', () => {
    const original = dollars('125.37').negate();
    const revived = Money.fromJSON(original.toJSON());
    expect(revived.equals(original)).toBe(true);
  });

  it('formats for display', () => {
    expect(dollars('1234.56').format('en-US')).toBe('$1,234.56');
    expect(dollars('0.00').format('en-US')).toBe('$0.00');
  });

  it('has a debuggable toString', () => {
    expect(dollars('125.37').toString()).toBe('USD 125.37');
  });

  it('marks the lossy number conversion as unsafe', () => {
    // Present for charting only. The name is the warning.
    expect(dollars('125.37').unsafeToNumber()).toBeCloseTo(125.37, 10);
    expect('toNumber' in dollars('1.00')).toBe(false);
  });
});

describe('Money in RCM scenarios', () => {
  it('reconciles a standard adjudication', () => {
    // Charged 500.00 / allowed 320.00 / contractual write-off 180.00,
    // patient responsibility 64.00 (20% coinsurance), payer pays 256.00.
    const charged = dollars('500.00');
    const allowed = dollars('320.00');
    const writeOff = charged.subtract(allowed);
    const patientResponsibility = money(allowed.multiply('0.20', 'half-up'));
    const payerPaid = allowed.subtract(patientResponsibility);

    expect(writeOff.toDecimalString()).toBe('180.00');
    expect(patientResponsibility.toDecimalString()).toBe('64.00');
    expect(payerPaid.toDecimalString()).toBe('256.00');

    // The balance identity: allowed = payer paid + patient responsibility.
    expect(payerPaid.add(patientResponsibility).equals(allowed)).toBe(true);
    // And charged = allowed + write-off.
    expect(allowed.add(writeOff).equals(charged)).toBe(true);
  });

  it('computes a variance without asserting it is leakage', () => {
    // A variance is arithmetic. Whether it is a finding is a separate judgment
    // that belongs to Revenue Intelligence, not to Money.
    const expected = dollars('256.00');
    const actual = dollars('205.00');
    const variance = expected.subtract(actual);
    expect(variance.toDecimalString()).toBe('51.00');
    expect(variance.isPositive()).toBe(true);
  });

  it('shows zero payer payment fully explained by patient responsibility', () => {
    // A $0 payer payment is not automatically an underpayment: here the entire
    // allowed amount landed on an unmet deductible.
    const allowed = dollars('180.00');
    const deductible = dollars('180.00');
    const payerPaid = Money.zero('USD');
    expect(payerPaid.add(deductible).equals(allowed)).toBe(true);
    expect(payerPaid.isZero()).toBe(true);
  });

  it('prorates a claim-level adjustment across lines by charge weight', () => {
    const lineCharges = [dollars('250.00'), dollars('125.00'), dollars('125.00')];
    const claimTotal = Money.sum(lineCharges, 'USD');
    expect(claimTotal.toDecimalString()).toBe('500.00');

    const adjustment = dollars('75.01');
    const weights = lineCharges.map((c) => Number(c.minorUnits));
    const prorated = adjustment.allocate(weights);

    // Line sums must equal the claim-level adjustment exactly, or the claim
    // will not balance.
    expect(Money.sum(prorated, 'USD').equals(adjustment)).toBe(true);
    expect(prorated.map((p) => p.toDecimalString())).toEqual([
      '37.51',
      '18.75',
      '18.75',
    ]);
  });

  it('nets a recoupment against an earlier payment to exactly zero', () => {
    const payment = dollars('256.00');
    const recoupment = payment.negate();
    expect(payment.add(recoupment).isZero()).toBe(true);
  });

  it('computes line charges from units exactly', () => {
    // 3 units @ 45.50 + 1 unit @ 213.50 = 350.00 charged.
    const lineOne = dollars('45.50').multiplyByUnits(3n);
    const lineTwo = dollars('213.50').multiplyByUnits(1n);
    expect(lineOne.toDecimalString()).toBe('136.50');
    expect(Money.sum([lineOne, lineTwo], 'USD').toDecimalString()).toBe('350.00');
  });

  it('demonstrates that per-line rounding does not equal claim-level rounding', () => {
    // A real and consequential RCM behavior, asserted here so it can never
    // regress into an unexamined assumption.
    //
    // Applying a 65% contract rate per line and summing gives a DIFFERENT
    // result than applying it once to the claim total:
    //
    //   per-line:    round(136.50 x .65) + round(213.50 x .65)
    //              = round(88.7250)      + round(138.7750)
    //              = 88.73               + 138.78            = 227.51
    //   claim-level: round(350.00 x .65) = round(227.5000)    = 227.50
    //
    // Neither is "wrong" — they answer different questions. What is wrong is
    // computing one and reconciling against the other, which manifests as a
    // phantom one-cent variance and, at scale, as a queue of spurious findings
    // that destroys a reviewer's trust in the tool.
    //
    // The rule this pins down: a payer contract specifies the level at which
    // its rate applies, and the expected-payment calculation must apply it at
    // that level and then ALLOCATE downward (see `allocate`) rather than
    // recomputing per line. Revenue Intelligence must therefore record which
    // level produced an expectation as part of its evidence.
    const lineOne = dollars('136.50');
    const lineTwo = dollars('213.50');

    const perLine = Money.sum(
      [lineOne, lineTwo].map((line) => money(line.multiply('0.65', 'half-up'))),
      'USD',
    );
    const claimLevel = money(
      Money.sum([lineOne, lineTwo], 'USD').multiply('0.65', 'half-up'),
    );

    expect(perLine.toDecimalString()).toBe('227.51');
    expect(claimLevel.toDecimalString()).toBe('227.50');
    expect(perLine.equals(claimLevel)).toBe(false);
    expect(perLine.subtract(claimLevel).minorUnits).toBe(1n);
  });

  it('allocates a claim-level expectation down to lines without drift', () => {
    // The correct pattern when a contract rate applies at claim level: compute
    // once, then allocate by charge weight. The lines now reconcile to the
    // claim total exactly, so no phantom variance is produced.
    const lineCharges = [dollars('136.50'), dollars('213.50')];
    const claimLevel = money(
      Money.sum(lineCharges, 'USD').multiply('0.65', 'half-up'),
    );

    const perLineExpectation = claimLevel.allocate(
      lineCharges.map((c) => Number(c.minorUnits)),
    );

    expect(Money.sum(perLineExpectation, 'USD').equals(claimLevel)).toBe(true);
    // Both shares land on an exact .5 remainder (8872.5 and 13877.5 cents), so
    // the deterministic lower-index tiebreak awards the odd cent to line 1.
    // Arbitrary, but *stable* — the same claim always yields the same split,
    // which is what makes a finding reproducible on replay.
    expect(perLineExpectation.map((p) => p.toDecimalString())).toEqual([
      '88.73',
      '138.77',
    ]);
  });
});
