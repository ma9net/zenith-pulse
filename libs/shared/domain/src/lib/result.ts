/**
 * Explicit success/failure type for domain operations.
 *
 * Why not exceptions? In a financial/audit system, failure is a domain outcome
 * that must be inspectable and explainable, not a control-flow side effect.
 * A thrown `Error('[big.js] Invalid number')` from four frames deep tells a
 * user nothing about WHICH field of WHICH claim line was malformed. A `Result`
 * carrying a structured error union does, and the compiler forces the caller
 * to acknowledge the failure path.
 *
 * Exceptions remain appropriate for programmer errors (broken invariants that
 * indicate a bug, not bad input) — see `Money.fromMinorUnits`.
 */
export type Result<T, E> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;

export const isErr = <T, E>(result: Result<T, E>): result is Err<E> =>
  !result.ok;

/** Maps the success value, leaving a failure untouched. */
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Maps the error, leaving a success untouched. */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/** Chains an operation that may itself fail. */
export function flatMap<T, U, E, F>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, F>,
): Result<U, E | F> {
  return result.ok ? fn(result.value) : result;
}

/**
 * Collects an array of results into a result of an array.
 *
 * Fails fast on the first error. Used when parsing a claim's service lines:
 * one malformed line invalidates the claim, and the first error is the one
 * worth reporting.
 */
export function all<T, E>(
  results: readonly Result<T, E>[],
): Result<readonly T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }
  return ok(values);
}

/** Returns the success value, or `fallback` on failure. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Returns the success value, or throws.
 *
 * Intended for tests and for trusted literals where a failure genuinely is a
 * programmer error. Never call this on external input.
 */
export function expect<T, E>(result: Result<T, E>, message: string): T {
  if (!result.ok) {
    throw new Error(`${message}: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}
