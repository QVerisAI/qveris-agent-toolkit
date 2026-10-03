# Agent Toolkit maintenance tasks

Internal checklist, started 2026-10-03. Implementation is on `linfangw/toolkit-maintenance`, based on `origin/main` at `b3407d3`. Checkboxes describe local implementation and verification; external gates remain separate.

## Implementation order

- [x] **T1 — CI coverage and script-test entrypoint (P1).** Root `test` and CI run all repository script regressions and OpenAPI/ecosystem validators. Scripts and package TypeScript/Vitest configuration trigger CI; regressions cover target selection and planner dependencies.
- [x] **T2 — PR blockers: diagnosis and source fixes (P1).** #413 exposed the new `updated_at` catalog field; JS/MCP/Python models now declare it. #410 requires Node 24.16 for its new OpenClaw version; plugin contract/publish jobs and plugin-selected lint use that runtime. #415's two high findings are synthetic newline fixtures; equivalent concatenated fixtures pass the exact v3.12.1 hardcoded-secret detector. Scanner JSON reports are retained without weakening the high-severity gate. #411/#412/#413 touch the same nine contract paths; prefer newest #413 after rebase/validation. Remote checks and PR disposition remain pending.
- [x] **T3 — Delegation cache lifecycle (P1).** JS/Python caches prune expired credentials, retain at most 128 entries with LRU eviction, and prevent pre-clear exchanges from repopulating the cache. Clear detaches coalescing without cancelling existing consumers; identity guards prevent old completions from removing new exchanges. Concurrency/expiry/eviction regressions pass.
- [x] **T4 — Published Capability clients (P1).** Public OpenAPI `2026-09-21.1` publishes Detail/Query and projection fixtures. JS/Python expose typed methods/models. Paid Query submits once, refuses retry/redirect replay, validates execution fields and retains execution identity for reconciliation. Transport/contract tests and API references are updated. Resolve/selection/idempotency remain external gates.
- [x] **T5 — Adapter compatibility (P2).** Packed SDK runtime/schema/host-identity and TypeScript `ToolSet` checks pass all six AI SDK 5.0.0/6/7 × Zod 3.25.76/4 combinations. Supported ranges are `ai >=5 <8` and `zod ^3.25.76 || ^4`; stable structural tool declarations avoid version-specific fields. CI repeats the matrix and installs CrewAI with a no-skips gate. Isolated CrewAI tests pass locally.
- [x] **T6 — Optional Probe tools (P2).** JS AI and six Python adapters offer opt-in Probe; defaults retain three tools. Host-controlled identity and supported correlation metadata remain outside model input. Conditional guidance explains quote semantics; conformance/schema tests and matching SDK guides are updated.
- [x] **T7 — Issue audit and update drafts (P2).** #200/#228 are stale after merged #294; confidential-client live acceptance remains incomplete. #293 now separates available Detail/Query from missing Resolve/selection/recovery. #368 acceptance is reconciled with dated evidence. Exact proposed body updates are in [maintenance/ISSUE_UPDATES.md](maintenance/ISSUE_UPDATES.md); they have not been posted.

## Validation evidence

- CLI: 211 tests. MCP: 262 tests including loopback HTTP. Plugin: 130 unit tests plus 31 registry-script tests.
- JS SDK: 187 tests; statement/line coverage above 96%, exceeding its gate.
- The same 187 JS tests also pass on Node 18.20.8 and Node 20; the core SDK release matrix retains Node 18/20/22 and adds 24. Peer-specific consumer tests use their required runtime.
- Python SDK: 719 passed, 2 skipped in the standard dev environment; coverage above 90%, exceeding the 82% gate. Optional CrewAI dependencies account for both skips; isolated CrewAI native integration tests: 18 passing without skips.
- Repository scripts: 96 tests plus 19 validator internal cases. Agent recovery: 24 tests. Packed AI/Zod consumers: six combinations passing.
- Package typechecks, lint, generated API docs, public-copy and locale checks pass.
- Full local scanner v3.12.1 on a clean source copy: score 100, grade A, no findings; the unchanged minimum-score/high-severity thresholds and remote action checks pass.
- [PR #416](https://github.com/QVerisAI/qveris-agent-toolkit/pull/416) implementation commit `7dd9691`: all executable PR checks passed, including locked Python 3.11 CrewAI, six packed peer combinations, OpenClaw packed installs/runtime checks, both scanner runs, generated-doc checks and Windows release-tool tests. Draft-only automatic review steps were skipped as configured.
- Required region/domain scans: no new public-document leaks. Existing matches are historical changelog text or explicitly internal/China-facing documents; cross-domain scan has no matches.
- No paid API execution or production credential was used for verification.

## Remaining external gates

- [x] Fresh PR checks for locked Python 3.11 CrewAI, OpenClaw packed installs and full scanner. Windows SDK/core release matrices still run through scheduled/tag workflows; PR coverage includes Windows release tools.
- [x] Approve/merge independent green dependency PRs #401/#408/#414; close superseded documentation snapshots #411/#412 and retain newest #413. Integrate current main into the maintenance branch and validate its doc generator output.
- [ ] Merge reviewed maintenance changes, then refresh/revalidate #410/#413/#415 with those source fixes. Python dependency PRs #403–#407 need matching lockfile updates; #404 also needs Python-version dependency conditions.
- [ ] Apply reviewed issue-body drafts.
- [ ] Registered confidential test client: live delegation success, expiry, wrong-audience and revoke/introspection. Keep credentials outside the repository.
- [ ] Published Resolve, selection freshness, idempotency and execution-lookup contracts before extending recovery.
- [ ] Local Awesome MCP upstream #14435 acceptance, Cursor submission and mcp.so ingestion. Recheck current directory runtime health separately from historical acceptance.
- [ ] Review/merge this branch, then release packages and published surfaces through existing workflows.
