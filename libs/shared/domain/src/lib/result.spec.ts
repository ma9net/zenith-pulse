import { describe, expect, it } from 'vitest';
import {
  all,
  err,
  expect as unwrapOrThrow,
  flatMap,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  unwrapOr,
} from './result';

describe('Result', () => {
  it('constructs and narrows a success', () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });

  it('constructs and narrows a failure', () => {
    const result = err({ kind: 'nope' } as const);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe('nope');
    }
  });

  it('maps a success and passes a failure through', () => {
    expect(map(ok(2), (n) => n * 2)).toEqual(ok(4));
    expect(map(err('boom'), (n: number) => n * 2)).toEqual(err('boom'));
  });

  it('maps an error and passes a success through', () => {
    expect(mapErr(err('boom'), (e) => `${e}!`)).toEqual(err('boom!'));
    expect(mapErr(ok(2), (e: string) => `${e}!`)).toEqual(ok(2));
  });

  it('chains fallible operations', () => {
    const double = (n: number) => ok(n * 2);
    const fail = () => err('bad');
    expect(flatMap(ok(2), double)).toEqual(ok(4));
    expect(flatMap(ok(2), fail)).toEqual(err('bad'));
    expect(flatMap(err('early'), double)).toEqual(err('early'));
  });

  it('collects results and fails fast on the first error', () => {
    // Used when parsing a claim's service lines: one malformed line invalidates
    // the claim, and the first error is the one worth surfacing.
    expect(all([ok(1), ok(2), ok(3)])).toEqual(ok([1, 2, 3]));
    expect(all([ok(1), err('second'), err('third')])).toEqual(err('second'));
  });

  it('collects an empty list to an empty success', () => {
    expect(all([])).toEqual(ok([]));
  });

  it('falls back on failure', () => {
    expect(unwrapOr(ok(1), 99)).toBe(1);
    expect(unwrapOr(err('x'), 99)).toBe(99);
  });

  it('throws with the structured error attached when unwrapping a failure', () => {
    expect(() => unwrapOrThrow(ok(1), 'should not throw')).not.toThrow();
    expect(() => unwrapOrThrow(err({ kind: 'empty' }), 'invalid id')).toThrow(
      /invalid id.*empty/,
    );
  });
});
