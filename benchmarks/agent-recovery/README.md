# Agent recovery benchmark

This benchmark measures the deterministic client workflow around copied service/task contexts. It uses synthetic HTTP fixtures only and must not be presented as production availability or provider success.

Run the CI-safe lane:

```bash
npm run benchmark:agent-recovery
npm run metrics:agent-recovery -- --fail-on-alert
npm run test:agent-recovery
```

The fixture lane covers ordinary success, service-only handoff, expired context refresh, additive unknown fields, incomplete schema inspection, missing quote, denied permission, insufficient balance, upstream failure, unknown settlement, and provider fallback. Fixture schema v2 declares whether each case is completion-eligible, autonomous-completion-eligible, expected to exercise recovery, and expected to require a specific user intervention. The benchmark validates these declarations before execution.

The primary metrics intentionally separate product quality from correct safety stops:

- `expected_outcome_rate` measures whether every fixture reached its declared terminal state.
- `completion.eligible_task_completion_rate` uses only cases that can complete under the supplied fixture state.
- `completion.autonomous_task_completion_rate` further limits the denominator to cases with enough information and authority for autonomous completion.
- `recovery` reports attempted recovery, expected recovery outcomes, completed tasks, unresolved settlements, and failures separately.
- `intervention` distinguishes required, correct actions from unexpected user escalation. An unknown settlement with `requires_user: false` is not counted as user intervention.
- `safety` reports false rejection only for autonomous-eligible cases, unexpected contract rejection, non-autonomous outcome accuracy, and any replay of a submitted Call.

`completion.all_fixture_completion_rate` remains as a workload-mix diagnostic. It must not be presented as the product task-completion rate because its denominator includes fixtures that are deliberately blocked, failed, or unresolved.

The optional live lane is separate and read-only:

```bash
QVERIS_API_KEY=... node benchmarks/agent-recovery/src/live-smoke.mjs
```

A live-lane failure is classified as an environment-or-service observation, never folded into deterministic product regression numbers. The live lane performs Discover only and makes no paid Call.

## Frozen baseline

The checked-in `results/before.json` and `results/after.json` files use the same 11 cases and schema-v2 eligibility declarations. They are evidence for client-policy behavior, not production claims.

| Metric | Before | After |
|---|---:|---:|
| Expected outcome rate | 36.4% | 100% |
| Completion-eligible task completion | 0% | 83.3% |
| Autonomous task completion | 0% | 100% |
| First-attempt autonomous completion | 0% | 40% |
| All-fixture completion diagnostic | 0% | 45.5% |
| Recovery attempted | 50% | 100% |
| Recovery expected outcome | 0% | 100% |
| Recovery task completion | 0% | 75% |
| Recovery unresolved | 0% | 25% |
| Required intervention action accuracy | 75% | 100% |
| Unexpected intervention | 0% | 0% |
| Autonomous false rejection | 100% | 0% |
| Unexpected autonomous contract rejection | 100% | 0% |
| Non-autonomous outcome accuracy | 66.7% | 100% |
| Submitted Call replays | 0 | 0 |
| Mean / p50 / p95 API rounds | 1.18 / 1 / 2 | 2.18 / 2 / 4 |
| Discover hit rate | 81.8% | 81.8% |
| Provider/tool fallback success | 0% | 100% |
| Unknown-price continuation | 0% | 100% |

Four fixtures require user action: tool selection, quote policy, permission, and credits. Unknown settlement is reported separately as unresolved recovery because its next action does not require the user. No paid Call is replayed automatically.

## Post-merge observability baseline

`fixtures/operational-events.v1.json` is a controlled task-level telemetry fixture for the same 11 recovery classes. It adds the evidence that a client-only benchmark cannot safely infer: submitted Call attempts, `execution_id`, terminal recovery actions, distinct settlement IDs, final charge outcomes, and settled credit amounts. It is synthetic and does not make a production-success claim.

Run the evaluator against the controlled fixture or a server export with the same schema:

```bash
npm run metrics:agent-recovery
npm run metrics:agent-recovery -- --input /path/to/recovery-events.json --output /tmp/recovery-metrics.json
npm run metrics:agent-recovery -- --input /path/to/recovery-events.json --fail-on-alert
```

The checked-in `results/operational-baseline.v1.json` is content-addressed to both the input fixture and `config/alerts.v1.json`. Every rate preserves its numerator and denominator; a rate is `null` and its alert status is `insufficient_data` until the configured minimum denominator is reached.

An operational export declares `production_data`, contains one record per logical recovery task, and keeps `calls` in submission order. `submission_outcome: rejected` means the server proved that execution did not start; every other outcome belongs in execution-ID and settlement-coverage denominators. `settlements` contains Usage/Ledger observations with stable `settlement_id`, final or pending `charge_outcome`, and non-negative `amount_credits`. Exports must omit user identity, prompts, parameters, credentials, and provider payloads.

| Metric | Controlled baseline | Denominator |
|---|---:|---|
| Task completion | 5 / 6 (83.3%) | Tasks explicitly eligible to complete with supplied state and authority |
| Automatic recovery success | 3 / 4 (75.0%) | Tasks where automatic recovery was attempted |
| Duplicate Call tasks | 0 / 8 (0%) | Tasks with at least one submitted Call request |
| Duplicate charge tasks | 0 / 4 (0%) | Tasks with at least one distinct charge-bearing final settlement |
| `review_settlement` | 0 / 2 (0%) | Submitted Call tasks ending in a settlement recovery action |
| Missing `execution_id` | 0 / 7 (0%) | Non-rejected submitted Call attempts |
| Final settlement evidence | 6 / 7 (85.7%) | Non-rejected submitted Call tasks |

Duplicate Call, duplicate charge, and missing `execution_id` have zero-tolerance critical guardrails. The other initial thresholds are a controlled post-merge contract, not production SLOs: task completion at least 80%, automatic recovery success at least 75%, `review_settlement` at most 10%, and final settlement evidence coverage at least 80%. Production owners should collect representative volume before tightening warning thresholds; the three zero-tolerance safety thresholds must remain zero.

The evaluator deduplicates settlement observations by `settlement_id`, so repeated ingestion of the same Usage/Ledger row is not misclassified as a duplicate charge. A second distinct charge-bearing settlement for the same logical recovery task is critical. Likewise, any second submitted Call request for a task is critical even if the first response was lost. This preserves the single-submission rule for paid or non-idempotent Calls.

In GitHub Actions, `--fail-on-alert` emits one error annotation per breached metric and fails the job. The weekly contract workflow evaluates the frozen baseline so schema, denominator, and alert-policy regressions cannot merge silently. Wiring production exports into the same evaluator belongs in the backend observability pipeline; production data must not be committed to this repository.

## Backend priorities from the controlled data

1. **P0 — Preserve execution identity and single settlement.** The controlled baseline records 0 / 8 duplicate Call tasks, 0 / 4 duplicate-charge tasks, and 0 / 7 missing execution IDs. The server should allocate `execution_id` before provider dispatch, return it on every post-submission success and error path, attach it to Usage/Ledger records, and enforce one charge-bearing settlement identity per logical task or idempotency key. Any non-zero result is a correctness incident, not a retry opportunity.
2. **P1 — Make final settlement correlation complete.** Final evidence is available for 6 / 7 non-rejected submitted tasks (85.7%); the remaining task is deliberately pending. Add exact `execution_id` filters to both Usage and Ledger, preserve final charge outcomes, and publish a stable settlement ID so pending work can converge without replaying Call.
3. **P2 — Improve recoverability after the safety contract is server-owned.** Automatic recovery completes 3 / 4 attempted cases (75%); the unresolved case is settlement uncertainty, not provider selection. Server-enforced credit caps, stable `service_id`, and explicit side-effect/idempotency signals should precede broader automatic fallback.
4. **P3 — Reduce manual settlement review with production volume.** The controlled `review_settlement` rate is 0 / 2. Once production denominators are representative, segment this metric by status family, provider, client, and charge outcome, then address the largest evidence-loss path. Do not lower review volume by retrying an uncertain Call.

## External handoff

Website context producers should always preserve a stable public `service_id` for exact-tool contexts and continue keeping parameters, prompts, payloads, and credentials outside the copied context.

Backend contracts should expose stable `service_id`, side-effect/idempotency signals, a server-enforced execution credit cap, and final Usage/Ledger correlation by `execution_id` (including a ledger execution filter). Errors emitted after submission should preserve `execution_id`. These fields would let all clients distinguish safe fallback from guesswork and final settlement from unknown settlement.

The CLI remains the canonical high-level context consumer. MCP and both SDKs now expose machine-readable error recovery guidance, but moving the complete context refresh/fallback workflow into those clients should wait until the public backend contract owns the context schema and service-equivalence semantics.
