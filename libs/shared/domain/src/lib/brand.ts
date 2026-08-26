/**
 * Nominal ("branded") typing primitive.
 *
 * The brand key is a module-private `unique symbol`, which means a brand cannot
 * be forged from outside this module: a hand-written `{ __brand: 'ClaimId' }`
 * object literal will NOT satisfy `Brand<string, 'ClaimId'>`, because callers
 * have no way to reference the symbol. This is the difference between a brand
 * that documents intent and a brand that is actually enforced.
 *
 * The property is declared but never assigned at runtime — it exists purely in
 * the type system, so branded values carry zero runtime overhead and serialize
 * exactly like their underlying primitive.
 */
declare const brand: unique symbol;

export type Brand<TValue, TBrand extends string> = TValue & {
  readonly [brand]: TBrand;
};

/**
 * Strips a brand, yielding the underlying primitive.
 *
 * Useful at serialization boundaries where a plain `string`/`number` is
 * required. Prefer letting structural assignability handle this implicitly
 * (a `ClaimId` IS a `string`); reach for `Unbrand` only when a type-level
 * transformation is genuinely needed.
 */
export type Unbrand<T> = T extends Brand<infer TValue, string> ? TValue : T;
