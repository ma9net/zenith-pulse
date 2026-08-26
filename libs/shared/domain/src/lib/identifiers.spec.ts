import { describe, expect, it } from 'vitest';
import {
  claimId,
  findingId,
  lineId,
  payerId,
  ruleId,
  unsafeClaimId,
  type ClaimId,
  type IdentifierError,
  type IdentifierKind,
} from './identifiers';
import { isErr, isOk, type Result } from './result';

describe('identifier smart constructors', () => {
  it('accepts a well-formed identifier', () => {
    const result = claimId('CLM-2024-000123');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe('CLM-2024-000123');
    }
  });

  it('accepts a UUID', () => {
    expect(isOk(claimId('3f2504e0-4f89-11d3-9a0c-0305e82c3301'))).toBe(true);
  });

  it('accepts a ULID', () => {
    expect(isOk(claimId('01ARZ3NDEKTSV4RRFFQ69G5FAV'))).toBe(true);
  });

  it('accepts a namespaced rule key', () => {
    expect(isOk(ruleId('underpayment.contract-variance:v1'))).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    const result = claimId('  CLM-1  ');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe('CLM-1');
    }
  });

  describe('rejects values the old cast-based factory accepted silently', () => {
    it('rejects an empty string', () => {
      const result = claimId('');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toEqual({ kind: 'empty', identifier: 'ClaimId' });
      }
    });

    it('rejects a whitespace-only string', () => {
      expect(isErr(claimId('   '))).toBe(true);
      expect(isErr(claimId('\t\n'))).toBe(true);
    });

    it('rejects an over-long identifier', () => {
      const result = claimId('C'.repeat(65));
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe('too-long');
      }
    });

    it('accepts an identifier exactly at the length bound', () => {
      expect(isOk(claimId('C'.repeat(64)))).toBe(true);
    });

    it.each([
      ["CLM'; DROP TABLE claims--", 'SQL injection payload'],
      ['<script>alert(1)</script>', 'HTML/script payload'],
      ['../../../etc/passwd', 'path traversal'],
      ['CLM 123', 'internal whitespace'],
      ['CLM\n123', 'embedded newline (log injection)'],
      ['CLM\u0000123', 'null byte'],
      ['CLM/123', 'path separator'],
      ['CLM#123', 'fragment delimiter'],
      ['CLM?a=b', 'query delimiter'],
      ['CLM%20123', 'percent encoding'],
    ])('rejects %s (%s)', (input) => {
      const result = claimId(input);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe('illegal-characters');
      }
    });
  });

  // Widened to `Result<string, ...>` deliberately: each constructor returns a
  // distinctly branded Ok type, and a union of those is not a single `Result`.
  // That the widening is necessary here is itself evidence the brands are real.
  const attributionCases: readonly [
    IdentifierKind,
    Result<string, IdentifierError>,
  ][] = [
    // The error has to be attributable, or a validation failure in a 500-line
    // claim batch is unactionable.
    ['ClaimId', claimId('')],
    ['LineId', lineId('')],
    ['RuleId', ruleId('')],
    ['PayerId', payerId('')],
    ['FindingId', findingId('')],
  ];

  it.each(attributionCases)('names %s as the offending identifier kind', (kind, result) => {
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.identifier).toBe(kind);
    }
  });

  it('never throws on hostile input; it returns an inspectable error', () => {
    expect(() => claimId('\u0000\uFFFF')).not.toThrow();
  });
});

describe('identifier nominal typing', () => {
  it('prevents passing one identifier type where another is expected', () => {
    const takesClaimId = (id: ClaimId): string => id;

    const claim = unsafeClaimId('CLM-1');
    expect(takesClaimId(claim)).toBe('CLM-1');

    // @ts-expect-error a plain string is not a ClaimId
    takesClaimId('CLM-1');

    // @ts-expect-error a LineId is not a ClaimId, despite both being strings
    takesClaimId(unsafeLineIdForTest('LINE-1'));
  });

  it('cannot be forged with a hand-written object literal', () => {
    const takesClaimId = (id: ClaimId): string => id;
    // The brand key is a module-private unique symbol, so no external code can
    // construct a value that satisfies it. This is the difference between a
    // brand that is enforced and one that is merely documentation.
    // @ts-expect-error the brand symbol is not nameable outside brand.ts
    takesClaimId('CLM-1' as string & { readonly __brand: 'ClaimId' });
  });

  it('remains a plain string at runtime with no wrapper overhead', () => {
    const claim = unsafeClaimId('CLM-1');
    expect(typeof claim).toBe('string');
    expect(JSON.stringify({ id: claim })).toBe('{"id":"CLM-1"}');
    expect(claim.startsWith('CLM')).toBe(true);
  });

  it('keeps unchecked rehydration greppable via the unsafe prefix', () => {
    // Trust assumptions must be findable by name.
    expect(unsafeClaimId('anything-goes-here')).toBe('anything-goes-here');
  });
});

// Declared here rather than imported so the cross-type assignment test above
// reads clearly.
function unsafeLineIdForTest(raw: string) {
  return raw as unknown as import('./identifiers').LineId;
}
