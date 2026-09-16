# Agent recovery benchmark

This benchmark measures the deterministic client workflow around copied service/task contexts. It uses synthetic HTTP fixtures only and must not be presented as production availability or provider success.

Run the CI-safe lane:

```bash
npm run benchmark:agent-recovery
npm run test:agent-recovery
```

The fixture lane covers ordinary success, service-only handoff, expired context refresh, additive unknown fields, incomplete schema inspection, missing quote, denied permission, insufficient balance, upstream failure, unknown settlement, and provider fallback. It reports task completion, API call rounds, Discover hits, contract rejections, bounded recovery, fallback, unknown-price continuation, user intervention, and false rejection of usable tools.

The optional live lane is separate and read-only:

```bash
QVERIS_API_KEY=... node benchmarks/agent-recovery/src/live-smoke.mjs
```

A live-lane failure is classified as an environment-or-service observation, never folded into deterministic product regression numbers. The live lane performs Discover only and makes no paid Call.

## Frozen baseline

The checked-in `results/before.json` and `results/after.json` files were produced from the same 11-case fixture set. They are evidence for client-policy behavior, not production claims.

| Metric | Before | After |
|---|---:|---:|
| First-attempt task completion | 0% | 18.2% |
| Overall task completion | 0% | 45.5% |
| Mean / p50 / p95 API rounds | 1.18 / 1 / 2 | 2.18 / 2 / 4 |
| Discover hit rate | 90.9% | 100% |
| Contract rejection rate | 90.9% | 18.2% |
| Automatic recovery success | 0% | 75% |
| Provider/tool fallback success | 0% | 100% |
| Unknown-price continuation | 0% | 100% |
| User interventions | 3 | 5 |
| False rejection of usable tools | 83.3% | 0% |

The higher intervention count is intentional: after removing the premature safety-metadata rejection, the fixtures reach the real boundaries (service-only selection, quote, permission, balance, and unknown settlement). No paid Call is replayed automatically.

## External handoff

Website context producers should always preserve a stable public `service_id` for exact-tool contexts and continue keeping parameters, prompts, payloads, and credentials outside the copied context.

Backend contracts should expose stable `service_id`, side-effect/idempotency signals, a server-enforced execution credit cap, and final Usage/Ledger correlation by `execution_id` (including a ledger execution filter). Errors emitted after submission should preserve `execution_id`. These fields would let all clients distinguish safe fallback from guesswork and final settlement from unknown settlement.

The CLI remains the canonical high-level context consumer. MCP and both SDKs now expose machine-readable error recovery guidance, but moving the complete context refresh/fallback workflow into those clients should wait until the public backend contract owns the context schema and service-equivalence semantics.
