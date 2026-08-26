import {
  currencyOf,
  minorUnits,
  type Currency,
  type CurrencyCode,
  type MinorUnits,
} from './currency';
import {
  divideRound,
  formatMinorUnits,
  parseDecimal,
  rescale,
  type DecimalParseError,
  type RoundingMode,
} from './decimal';
import { err, ok, type Result } from './result';

export type MoneyError =
  | DecimalParseError
  | {
      /**
       * Input carried more fraction digits than the currency can represent.
       *
       * Rejected rather than silently rounded: `"10.005"` in USD is either a
       * data-quality problem in the source system or a value that needs an
       * explicit rounding decision. Guessing would make the discrepancy
       * invisible, and an invisible half-cent is exactly the kind of thing that
       * makes a reconciliation impossible to explain.
       */
      readonly kind: 'excess-precision';
      readonly received: string;
      readonly currency: CurrencyCode;
      readonly maxFractionDigits: number;
    }
  | {
      readonly kind: 'currency-mismatch';
      readonly left: CurrencyCode;
      readonly right: CurrencyCode;
    };

/**
 * An exact monetary amount in a single currency.
 *
 * ## Representation
 *
 * A `bigint` count of the currency's minor units (`$125.37` -> `12537n` USD
 * cents) plus the currency identity. Consequences:
 *
 * - Addition and subtraction are **exact by construction**. There is no rounding
 *   mode, no precision setting, and no configuration to get wrong.
 *   `0.1 + 0.2 === 0.3` holds here, and no decimal library is required to make
 *   it hold.
 * - Rounding is confined to `multiply` and `allocate` — the only two operations
 *   where it is mathematically unavoidable — and both **require** an explicit
 *   `RoundingMode`.
 * - There is no global mutable state anywhere in the arithmetic path, so a
 *   value's behavior cannot be altered by unrelated code or a transitive
 *   dependency. Financial output is deterministic and reproducible, which is a
 *   precondition for a replayable audit trail.
 *
 * ## Currency safety
 *
 * The currency is a **type parameter**, so cross-currency arithmetic fails at
 * compile time:
 *
 * ```ts
 * const usd: Money<'USD'> = ...;
 * const eur: Money<'EUR'> = ...;
 * usd.add(eur); // ts(2345) — argument type mismatch
 * ```
 *
 * A runtime guard backs this up for paths where types are erased (JSON
 * boundaries, `any` from a mock API), returning a `currency-mismatch` error
 * rather than a wrong number. Currency *conversion* is deliberately absent: it
 * is out of MVP scope, and a `convert` method would invite an unaudited FX rate
 * into the financial core.
 *
 * ## Negative amounts
 *
 * Explicitly permitted. RCM is full of legitimately negative money: recoupments,
 * take-backs, refunds, claim reversals, and credit adjustments. A non-negative
 * money type would force callers to encode sign out-of-band, which is how sign
 * errors get introduced. Domain aggregates that require non-negativity (a gross
 * charge, for instance) enforce it as their own invariant — that is a claim-level
 * rule, not a property of money itself.
 *
 * ## Immutability
 *
 * Instances are frozen and every operation returns a new instance. The private
 * constructor plus a private field also gives `Money` nominal identity: no
 * structurally-similar object literal can masquerade as money.
 */
export class Money<C extends CurrencyCode = CurrencyCode> {
  readonly #units: bigint;
  readonly #currency: Currency;

  private constructor(units: bigint, currency: Currency) {
    this.#units = units;
    this.#currency = currency;
    Object.freeze(this);
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * Builds money from an exact count of minor units.
   *
   * The canonical constructor: total, exact, and cannot fail on a value basis.
   * Use for rehydrating persisted values and for results of prior exact math.
   */
  static fromMinorUnits<C extends CurrencyCode>(
    units: bigint | MinorUnits,
    currency: C,
  ): Money<C> {
    return new Money<C>(units as bigint, currencyOf(currency));
  }

  /**
   * Parses a decimal string into money.
   *
   * **The only entry point for untrusted input**, and deliberately
   * `string`-only. There is no `number` overload, because by the time a value
   * is a JS `number` any precision loss has already occurred:
   * `Money.parse(String(0.1 + 0.2))` would faithfully preserve
   * `0.30000000000000004`. Excluding `number` from the signature makes that
   * class of defect unrepresentable rather than merely discouraged.
   *
   * Rejects values with more fraction digits than the currency supports; use
   * {@link parseWithRounding} when rounding is an intentional business decision.
   */
  static parse<C extends CurrencyCode>(
    decimal: string,
    currency: C,
  ): Result<Money<C>, MoneyError> {
    const meta = currencyOf(currency);
    const parsed = parseDecimal(decimal);

    if (!parsed.ok) {
      return err(parsed.error);
    }

    if (parsed.value.scale > meta.exponent) {
      return err({
        kind: 'excess-precision',
        received: decimal,
        currency,
        maxFractionDigits: meta.exponent,
      });
    }

    return ok(
      new Money<C>(rescale(parsed.value, meta.exponent, 'half-up'), meta),
    );
  }

  /**
   * Parses a decimal string, rounding excess precision under `mode`.
   *
   * Separate from {@link parse} so that accepting precision loss is always a
   * visible, deliberate act at the call site.
   */
  static parseWithRounding<C extends CurrencyCode>(
    decimal: string,
    currency: C,
    mode: RoundingMode,
  ): Result<Money<C>, MoneyError> {
    const meta = currencyOf(currency);
    const parsed = parseDecimal(decimal);

    if (!parsed.ok) {
      return err(parsed.error);
    }

    return ok(new Money<C>(rescale(parsed.value, meta.exponent, mode), meta));
  }

  static zero<C extends CurrencyCode>(currency: C): Money<C> {
    return new Money<C>(0n, currencyOf(currency));
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  get currency(): C {
    return this.#currency.code as C;
  }

  /** Exact count of minor units. The lossless way to read an amount. */
  get minorUnits(): MinorUnits {
    return minorUnits(this.#units);
  }

  isZero(): boolean {
    return this.#units === 0n;
  }

  isNegative(): boolean {
    return this.#units < 0n;
  }

  isPositive(): boolean {
    return this.#units > 0n;
  }

  /** `-1`, `0`, or `1`. */
  signum(): -1 | 0 | 1 {
    if (this.#units === 0n) return 0;
    return this.#units < 0n ? -1 : 1;
  }

  // ---------------------------------------------------------------------------
  // Exact arithmetic — no rounding is possible in any of these
  // ---------------------------------------------------------------------------

  add(other: Money<C>): Money<C> {
    this.#assertSameCurrency(other);
    return new Money<C>(this.#units + other.#units, this.#currency);
  }

  subtract(other: Money<C>): Money<C> {
    this.#assertSameCurrency(other);
    return new Money<C>(this.#units - other.#units, this.#currency);
  }

  negate(): Money<C> {
    return new Money<C>(-this.#units, this.#currency);
  }

  absolute(): Money<C> {
    return this.#units < 0n
      ? new Money<C>(-this.#units, this.#currency)
      : this;
  }

  /**
   * Sums a collection exactly.
   *
   * Requires an explicit `currency` so that an empty collection still yields a
   * well-typed zero. A currency inferred from `list[0]` would throw on empty
   * input, and empty line sets are ordinary in claim processing.
   */
  static sum<C extends CurrencyCode>(
    // `NoInfer` blocks inference from this position, so `C` is fixed by the
    // `currency` argument alone. Without it, `C` widens to a union across both
    // parameters and `sum([usd, eur], 'USD')` would type-check, deferring a
    // currency error to the runtime guard. This keeps it a compile error.
    amounts: readonly Money<NoInfer<C>>[],
    currency: C,
  ): Money<C> {
    const meta = currencyOf(currency);
    let total = 0n;
    for (const amount of amounts) {
      if (amount.#currency.code !== currency) {
        throw new TypeError(
          `Money.sum received ${amount.#currency.code} in a ${currency} collection`,
        );
      }
      total += amount.#units;
    }
    return new Money<C>(total, meta);
  }

  /**
   * Type-safe addition for paths where the currency is not statically known.
   *
   * Returns a `currency-mismatch` error instead of throwing, for use at
   * deserialization boundaries.
   */
  tryAdd(other: Money): Result<Money<C>, MoneyError> {
    if (other.#currency.code !== this.#currency.code) {
      return err({
        kind: 'currency-mismatch',
        left: this.#currency.code,
        right: other.#currency.code,
      });
    }
    return ok(new Money<C>(this.#units + other.#units, this.#currency));
  }

  // ---------------------------------------------------------------------------
  // Rate arithmetic — rounding is unavoidable, so the mode is mandatory
  // ---------------------------------------------------------------------------

  /**
   * Multiplies by a dimensionless rate given as an exact decimal string.
   *
   * The rate is a `string` for the same reason {@link parse} takes a string:
   * `0.2` is not exactly representable as a double, and a contract multiplier
   * that is silently off in the 17th digit produces a payment expectation that
   * is off by a cent on large amounts. Typical uses are coinsurance percentages,
   * contract multipliers, and sequestration reductions.
   */
  multiply(rate: string, mode: RoundingMode): Result<Money<C>, MoneyError> {
    const parsed = parseDecimal(rate);
    if (!parsed.ok) {
      return err(parsed.error);
    }

    const product = this.#units * parsed.value.units;
    const divisor = 10n ** BigInt(parsed.value.scale);

    return ok(
      new Money<C>(divideRound(product, divisor, mode), this.#currency),
    );
  }

  /** Multiplies by an integer count, e.g. service-line units. Exact. */
  multiplyByUnits(count: bigint): Money<C> {
    return new Money<C>(this.#units * count, this.#currency);
  }

  /**
   * Divides into `parts` equal shares, distributing the remainder.
   *
   * Equivalent to `allocate` with uniform weights; see it for the invariant.
   */
  divide(parts: number): readonly Money<C>[] {
    if (!Number.isInteger(parts) || parts <= 0) {
      throw new RangeError(`divide requires a positive integer, got ${parts}`);
    }
    return this.allocate(new Array<number>(parts).fill(1));
  }

  /**
   * Splits the amount across `weights` with **zero penny loss**.
   *
   * ```
   * INVARIANT: Money.sum(m.allocate(w), c).equals(m) — always, exactly.
   * ```
   *
   * This is the operation naive code gets wrong, and the failure is expensive.
   * Prorating a $100.00 claim-level adjustment across three lines by dividing
   * and rounding yields `33.33 * 3 = 99.99` — a penny vanishes, the service
   * lines no longer reconcile to the claim total, and the claim becomes
   * unbalanced. That is what payers reject 837s over and what makes an audit
   * finding indefensible.
   *
   * The algorithm floors each share, then distributes the leftover minor units
   * one at a time in descending-remainder order (largest-remainder method).
   * Ties break toward the lower index, so the result is fully deterministic for
   * a given input — a requirement for reproducible audit output.
   *
   * Negative totals allocate correctly too, so a recoupment prorates as the
   * exact mirror of the payment it reverses.
   */
  allocate(weights: readonly number[]): readonly Money<C>[] {
    if (weights.length === 0) {
      throw new RangeError('allocate requires at least one weight');
    }

    const asBigInts = weights.map((weight) => {
      if (!Number.isInteger(weight) || weight < 0) {
        throw new RangeError(
          `allocate requires non-negative integer weights, got ${weight}`,
        );
      }
      return BigInt(weight);
    });

    const totalWeight = asBigInts.reduce((sum, weight) => sum + weight, 0n);
    if (totalWeight === 0n) {
      throw new RangeError('allocate requires at least one non-zero weight');
    }

    const negative = this.#units < 0n;
    const magnitude = negative ? -this.#units : this.#units;

    // Floor each share, tracking remainders for largest-remainder distribution.
    const shares: bigint[] = [];
    const remainders: { index: number; remainder: bigint }[] = [];
    let distributed = 0n;

    asBigInts.forEach((weight, index) => {
      const scaled = magnitude * weight;
      const share = scaled / totalWeight;
      shares.push(share);
      remainders.push({ index, remainder: scaled % totalWeight });
      distributed += share;
    });

    // Hand out leftover units to the largest remainders first; index breaks ties.
    let leftover = magnitude - distributed;
    remainders.sort(
      (a, b) =>
        (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : 0) ||
        a.index - b.index,
    );

    for (const { index } of remainders) {
      if (leftover <= 0n) break;
      // A zero weight must never receive a unit: a line excluded from a
      // proration stays excluded.
      if (asBigInts[index] === 0n) continue;
      shares[index] = (shares[index] as bigint) + 1n;
      leftover -= 1n;
    }

    return shares.map(
      (share) =>
        new Money<C>(negative ? -share : share, this.#currency),
    );
  }

  // ---------------------------------------------------------------------------
  // Comparison
  // ---------------------------------------------------------------------------

  /**
   * Value equality: same currency AND same amount.
   *
   * Deterministic and total. Note `$0.00 USD` does not equal `¥0 JPY` — zero is
   * still denominated.
   */
  equals(other: Money): boolean {
    return (
      this.#currency.code === other.#currency.code &&
      this.#units === other.#units
    );
  }

  /** `-1 | 0 | 1`. Throws on currency mismatch: ordering across currencies is meaningless. */
  compare(other: Money<C>): -1 | 0 | 1 {
    this.#assertSameCurrency(other);
    if (this.#units === other.#units) return 0;
    return this.#units < other.#units ? -1 : 1;
  }

  greaterThan(other: Money<C>): boolean {
    return this.compare(other) > 0;
  }

  greaterThanOrEqual(other: Money<C>): boolean {
    return this.compare(other) >= 0;
  }

  lessThan(other: Money<C>): boolean {
    return this.compare(other) < 0;
  }

  lessThanOrEqual(other: Money<C>): boolean {
    return this.compare(other) <= 0;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * Canonical decimal string, always with the currency's full fraction digits.
   *
   * `"125.37"` for USD, `"1200"` for JPY. Byte-stable, so it is safe to hash,
   * diff, or store in an audit record.
   */
  toDecimalString(): string {
    return formatMinorUnits(this.#units, this.#currency.exponent);
  }

  /**
   * Lossless wire/persistence format.
   *
   * `minorUnits` is a string because `JSON.stringify` throws on `bigint` and
   * because a JSON `number` would reintroduce the precision loss this class
   * exists to prevent. Both fields are emitted so a consumer can read the exact
   * integer and a human can read the decimal.
   */
  toJSON(): {
    readonly currency: C;
    readonly minorUnits: string;
    readonly decimal: string;
  } {
    return {
      currency: this.#currency.code as C,
      minorUnits: this.#units.toString(),
      decimal: this.toDecimalString(),
    };
  }

  /** Rehydrates {@link toJSON} output. */
  static fromJSON<C extends CurrencyCode>(payload: {
    readonly currency: C;
    readonly minorUnits: string;
  }): Money<C> {
    return Money.fromMinorUnits<C>(BigInt(payload.minorUnits), payload.currency);
  }

  /** Locale-aware display string. Presentation only — never parse this back. */
  format(locale = 'en-US'): string {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.#currency.code,
      minimumFractionDigits: this.#currency.exponent,
      maximumFractionDigits: this.#currency.exponent,
    }).format(this.#asDisplayNumber());
  }

  toString(): string {
    return `${this.#currency.code} ${this.toDecimalString()}`;
  }

  /**
   * Lossy conversion to a JS `number`, **for display and charting only**.
   *
   * Named `unsafe` because that is what it is: beyond 2^53 minor units the
   * result is wrong, and any arithmetic performed on the output is outside this
   * class's exactness guarantees. Never round-trip a value through here, and
   * never use it in a calculation that reaches a finding or a reconciliation.
   */
  unsafeToNumber(): number {
    return this.#asDisplayNumber();
  }

  #asDisplayNumber(): number {
    return Number(this.#units) / Number(this.#currency.scale);
  }

  #assertSameCurrency(other: Money): void {
    if (this.#currency.code !== other.#currency.code) {
      // Unreachable through the type system; this catches type-erased paths
      // (JSON, `any`) where a wrong answer would be far worse than a crash.
      throw new TypeError(
        `Currency mismatch: cannot combine ${this.#currency.code} with ${other.#currency.code}`,
      );
    }
  }
}

/** Convenience helper for USD, the MVP's only operational currency. */
export const usd = (decimal: string): Result<Money<'USD'>, MoneyError> =>
  Money.parse(decimal, 'USD');
