# Zenith Pulse

A domain-first healthcare **Revenue Cycle Management (RCM) intelligence** system.
Its purpose is to identify where expected revenue is not being realized, and to
explain *why* — with the financial evidence behind every conclusion inspectable.

Angular is the current delivery mechanism, not the architecture. The business
domain is pure TypeScript and testable without a framework.

> **Status: early development.** The financial core is implemented and tested.
> The RCM domain model, rule engine, and UI are not yet built — see
> [Roadmap](#roadmap). All data is synthetic. Nothing here has processed real
> patient data.

## The core distinction

> **A financial variance is not revenue leakage.**

A variance is a mathematical observation. Leakage is a business interpretation
derived from evidence. Zenith Pulse is built so that it never claims
"the provider lost $5,000." It produces:

```
Potential Finding: Possible Underpayment
  Expected payer payment    $256.00   (source: contract model — not asserted as truth)
  Actual payer payment      $205.00
  Patient responsibility     $64.00   (deductible — NOT payer leakage)
  Contractual adjustment    $180.00
  Variance                   $51.00
  Adjudication reason        CARC 45
  Explanation               <human-readable reasoning>
```

Two consequences shape the whole design:

- **Expected amounts carry provenance.** An expectation supplied by an external
  contract-management system is labeled as such, so an upstream calculation error
  is never mistaken for a Zenith Pulse discovery.
- **A $0 payer payment is not automatically an underpayment.** It is frequently an
  unmet deductible, i.e. legitimate patient responsibility. Reporting it as
  leakage is a false positive, and a queue of false positives destroys a
  reviewer's trust in every other finding.

## Architecture

DDD and Clean Architecture, sized to the problem: **enterprise architecture
without enterprise-sized implementation.** No Kafka, no microservices, no event
sourcing, no premature multi-tenancy.

```
libs/
├── shared/domain/                 [scope:shared, type:domain, platform:agnostic]
│     Money, Result, Brand, identifiers, exact decimal arithmetic
│
├── claims/                        [scope:claims]
│   ├── domain/                    canonical claim lifecycle + financial facts
│   └── data-access/               repository ports and adapters
│
└── revenue-intelligence/          [scope:revenue-intelligence]
    ├── domain/                    variance calculation, rules, findings, evidence
    └── data-access/               finding retrieval and state
```

Dependencies point one way, and this is **enforced by lint**, not convention
(see [ADR 0003](docs/adr/0003-module-boundaries-via-nx-tags.md)):

```
revenue-intelligence  →  claims  →  shared
```

Revenue Intelligence may read Claims. Claims may not reach back — which leaves
room for a later `Claims → domain event → RI` relationship without a rewrite.
`platform:agnostic` libraries cannot acquire an Angular dependency, which makes
"the domain does not know about Angular" verifiable rather than aspirational.

External standards (FHIR, X12 837/835, ICD-10, CPT/HCPCS, CARC/RARC) are
**integration formats mapped at the boundary**, never the internal model. The
canonical domain model is Zenith Pulse's own.

## The financial core

`libs/shared/domain` is implemented and covered by 196 tests. It has **zero
runtime dependencies**.

Money is a `bigint` count of minor units plus a currency identity — `$125.37` is
`12537n` USD cents ([ADR 0001](docs/adr/0001-money-as-minor-units.md)):

```ts
// Addition and subtraction are exact by construction. No rounding mode, no
// precision setting, no global configuration to get wrong.
usd('0.10').add(usd('0.20'));           // exactly 0.30

// Parsing is string-only. A `number` parameter would admit float error that has
// already occurred, so the overload does not exist.
Money.parse(0.1, 'USD');                // compile error

// Cross-currency arithmetic is a compile error, not a runtime check.
usdAmount.add(eurAmount);               // compile error

// Rounding happens only where it is mathematically unavoidable, and the mode is
// always explicit — it is a business decision, so there is no default.
allowed.multiply('0.20', 'half-up');    // 20% coinsurance

// Allocation distributes remainders, so lines always reconcile to the total.
usd('100.00').allocate([1, 1, 1]);      // 33.34 + 33.33 + 33.33 — never 99.99
```

Identifiers are nominally typed via a module-private `unique symbol` and built by
validating smart constructors, so a `LineId` cannot be passed as a `ClaimId` and a
value typed `ClaimId` is genuinely well-formed
([ADR 0002](docs/adr/0002-branded-types-and-smart-constructors.md)).

## Getting started

Requires Node 24+.

```bash
npm install --legacy-peer-deps

# The financial core: lint, 196 tests, build, and typecheck
npx nx run-many -t lint test build typecheck --projects=domain

# Everything affected by your changes
npx nx affected -t lint test build typecheck

npx nx graph      # visualize the enforced boundaries
```

`typecheck` is a distinct target from `build` on purpose: `build` excludes spec
files, and several compile-time guarantees (no numeric `Money.parse`, no
cross-currency arithmetic) are asserted in specs via `@ts-expect-error`. Without
`typecheck` those assertions would go unverified — a gap that concealed a real
`Money.sum` inference defect until it was added.

## Testing philosophy

Business logic matters more than UI complexity, so the financial core is tested
disproportionately hard:

- **Invariant tests.** `sum(allocate(w)) === original` is asserted over 2,000
  seeded pseudo-random amount/weight combinations. Allocation must never create
  or destroy money.
- **Algebraic properties.** Commutativity, associativity, and additive inverse
  over 500 random triples each.
- **Boundary behavior.** Every rounding mode at its exact `.5` tie, for positive
  and negative values, plus an exhaustive sweep asserting no mode ever drifts by
  more than one minor unit.
- **Hostile input.** Injection, traversal, null-byte, and log-injection payloads
  against every identifier constructor.
- **Compile-time guarantees**, asserted with `@ts-expect-error` in bodies that are
  type-checked but never executed.
- **Determinism.** The same input must produce the same output on every run,
  because a finding has to be reproducible on replay.

Randomized tests use a seeded generator, so a failure is always replayable.

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| **1 — Financial core** | `Money`, exact decimals, branding, `Result`, enforced boundaries | **Done** |
| **2 — Claims domain** | `Claim`, `ClaimLine`, `Adjustment`, `PatientResponsibility`, `FinancialSummary`; submission/adjudication/payment as independent dimensions | Next |
| **3 — Revenue Intelligence** | Reconciliation, variance calculation, deterministic underpayment rule, evidence, explanation | Planned |
| **4 — Synthetic data** | MSW-backed realistic claim scenarios, repository adapters | Planned |
| **5 — Angular UI** | Zoneless + signals, claim detail with inspectable financial evidence | Planned |

The first vertical slice runs end to end before anything expands horizontally:

```
Synthetic claim → canonical model → lines → financial summary → reconciliation
  → variance → deterministic rule → potential finding → evidence → explanation → UI
```

Deliberately **not** in scope: AI/ML, currency conversion, event sourcing,
microservices, multi-tenancy, real payer integrations.

## Compliance posture

Zenith Pulse is **designed with awareness of** HIPAA, GDPR, HL7 FHIR, and X12
requirements. It is **not** certified or compliant with any of them, and it makes
no such claim. It processes synthetic data only.

Real deployment would require, at minimum: BAAs, encryption at rest and in
transit, tamper-evident audit logging with six-year retention, RBAC/ABAC with SSO,
PHI-scrubbing observability, and SOC 2 Type II. None of that is implemented, and
referencing a standard is not the same as conforming to it.

This is also not clinical decision support. It operates strictly in the
administrative and financial domain.

## Documentation

- [ADR 0001 — Money as integer minor units](docs/adr/0001-money-as-minor-units.md)
- [ADR 0002 — Branded types and smart constructors](docs/adr/0002-branded-types-and-smart-constructors.md)
- [ADR 0003 — Module boundaries via Nx tags](docs/adr/0003-module-boundaries-via-nx-tags.md)

## License

MIT
