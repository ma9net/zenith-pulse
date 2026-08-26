import type { Brand } from './brand';
import { err, ok, type Result } from './result';

/**
 * Canonical internal identifiers.
 *
 * Two distinct concerns are separated here, which the previous implementation
 * conflated:
 *
 * 1. **Type safety** — a `LineId` must not be assignable to a `ClaimId`. Handled
 *    by {@link Brand}.
 * 2. **Validity** — a value typed `ClaimId` should actually BE a well-formed
 *    claim identifier. Handled by the validating smart constructors below.
 *
 * A cast-only factory (`(id: string) => id as ClaimId`) delivers the first and
 * none of the second: it happily produces an empty, whitespace-only, or
 * wrong-entity `ClaimId`. Since these identifiers will arrive from mock APIs
 * today and 837/835 files tomorrow, validation belongs at construction.
 */

export type ClaimId = Brand<string, 'ClaimId'>;
export type LineId = Brand<string, 'LineId'>;
export type RuleId = Brand<string, 'RuleId'>;
export type PayerId = Brand<string, 'PayerId'>;
export type FindingId = Brand<string, 'FindingId'>;

export type IdentifierKind =
  | 'ClaimId'
  | 'LineId'
  | 'RuleId'
  | 'PayerId'
  | 'FindingId';

export type IdentifierError =
  | { readonly kind: 'empty'; readonly identifier: IdentifierKind }
  | {
      readonly kind: 'too-long';
      readonly identifier: IdentifierKind;
      readonly received: string;
      readonly maxLength: number;
    }
  | {
      readonly kind: 'illegal-characters';
      readonly identifier: IdentifierKind;
      readonly received: string;
      readonly allowed: string;
    };

/**
 * Maximum identifier length.
 *
 * 64 accommodates a UUID, a ULID, and the payer/provider control numbers found
 * in X12 (the 837 `CLM01` claim submitter identifier is capped at 38) with room
 * to spare, while still bounding the value so an identifier cannot become an
 * unbounded-input vector into a store key or log line.
 */
const MAX_LENGTH = 64;

/**
 * Permitted characters: ASCII alphanumerics plus `-`, `_`, `.`, and `:`.
 *
 * Wide enough for UUIDs, ULIDs, and namespaced rule keys such as
 * `underpayment.contract-variance.v1`. Narrow enough to exclude whitespace,
 * quotes, angle brackets, and path separators — the characters that turn an
 * identifier into an injection or path-traversal payload once it reaches a URL,
 * a query, or a filename.
 */
const ALLOWED = /^[A-Za-z0-9._:-]+$/;
const ALLOWED_DESCRIPTION = 'A-Z a-z 0-9 . _ : -';

function validate(
  raw: string,
  identifier: IdentifierKind,
): Result<string, IdentifierError> {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return err({ kind: 'empty', identifier });
  }

  if (trimmed.length > MAX_LENGTH) {
    return err({
      kind: 'too-long',
      identifier,
      received: trimmed,
      maxLength: MAX_LENGTH,
    });
  }

  if (!ALLOWED.test(trimmed)) {
    return err({
      kind: 'illegal-characters',
      identifier,
      received: trimmed,
      allowed: ALLOWED_DESCRIPTION,
    });
  }

  return ok(trimmed);
}

const constructor =
  <T extends string>(identifier: IdentifierKind) =>
  (raw: string): Result<T, IdentifierError> => {
    const validated = validate(raw, identifier);
    return validated.ok ? ok(validated.value as T) : validated;
  };

/**
 * Validating smart constructors — use these for all external input.
 *
 * Each returns a `Result`, so a malformed identifier surfaces as an inspectable
 * domain error naming the offending field rather than as a thrown exception.
 */
export const claimId = constructor<ClaimId>('ClaimId');
export const lineId = constructor<LineId>('LineId');
export const ruleId = constructor<RuleId>('RuleId');
export const payerId = constructor<PayerId>('PayerId');
export const findingId = constructor<FindingId>('FindingId');

/**
 * Unchecked rehydration for values already validated at an earlier boundary.
 *
 * Legitimate uses: test fixtures, and re-reading a row this system previously
 * wrote and validated. The `unsafe` prefix is deliberate — it makes every trust
 * assumption greppable, which is what an auditor (or a reviewer) needs to be
 * able to find.
 *
 * Never call these on data arriving from a user, an HTTP response, an X12 file,
 * or a FHIR payload.
 */
export const unsafeClaimId = (raw: string): ClaimId => raw as ClaimId;
export const unsafeLineId = (raw: string): LineId => raw as LineId;
export const unsafeRuleId = (raw: string): RuleId => raw as RuleId;
export const unsafePayerId = (raw: string): PayerId => raw as PayerId;
export const unsafeFindingId = (raw: string): FindingId => raw as FindingId;
