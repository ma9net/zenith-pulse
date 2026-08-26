/**
 * Revenue Intelligence bounded context — interprets claim facts into findings.
 *
 * Populated with the deterministic rule engine: `VarianceResult`,
 * `RuleDefinition`, `Evidence`, `Explanation`, and `PotentialFinding`.
 *
 * The load-bearing distinction this context exists to preserve: a variance is a
 * mathematical observation, whereas a finding is an interpretation supported by
 * evidence. This context produces the latter and must never assert a loss the
 * evidence does not support.
 */
export {};
