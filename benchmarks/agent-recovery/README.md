# Agent recovery benchmark

This benchmark measures the deterministic client workflow around copied service/task contexts. It uses synthetic HTTP fixtures only and must not be presented as production availability or provider success.

Run the CI-safe lane:

```bash
npm run benchmark:agent-recovery
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

## External handoff

Website context producers should always preserve a stable public `service_id` for exact-tool contexts and continue keeping parameters, prompts, payloads, and credentials outside the copied context.

Backend contracts should expose stable `service_id`, side-effect/idempotency signals, a server-enforced execution credit cap, and final Usage/Ledger correlation by `execution_id` (including a ledger execution filter). Errors emitted after submission should preserve `execution_id`. These fields would let all clients distinguish safe fallback from guesswork and final settlement from unknown settlement.

The CLI remains the canonical high-level context consumer. MCP and both SDKs now expose machine-readable error recovery guidance, but moving the complete context refresh/fallback workflow into those clients should wait until the public backend contract owns the context schema and service-equivalence semantics.
