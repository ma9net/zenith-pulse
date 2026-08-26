/**
 * Claims bounded context — canonical claim lifecycle and financial facts.
 *
 * Populated with the canonical model: `Claim`, `ClaimLine`,
 * `Adjustment`, `PatientResponsibility`, `FinancialSummary`, and the three
 * independent lifecycle dimensions (submission / adjudication / payment) that
 * must never collapse into a single `ClaimStatus` enum.
 *
 * Depends on `@org/domain` for `Money` and identifiers. Must never depend on
 * Angular or on the Revenue Intelligence context — both are enforced by
 * `@nx/enforce-module-boundaries` via this project's `platform:agnostic` and
 * `scope:claims` tags.
 */
export {};
