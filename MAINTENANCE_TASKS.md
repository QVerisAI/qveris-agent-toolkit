# Agent Toolkit maintenance tasks

Internal checklist, started 2026-10-03. The initial implementation on `linfangw/toolkit-maintenance`, based on `origin/main` at `b3407d3`, was merged in #416. Checkboxes describe completed implementation and verification; external gates remain separate.

## Implementation order

- [x] **T1 — CI coverage and script-test entrypoint (P1).** Root `test` and CI run all repository script regressions and OpenAPI/ecosystem validators. Scripts and package TypeScript/Vitest configuration trigger CI; regressions cover target selection and planner dependencies.
- [x] **T2 — PR blockers: diagnosis and source fixes (P1).** #413 exposed the new `updated_at` catalog field; JS/MCP/Python models now declare it. #410 requires Node 24.16 for its new OpenClaw version; plugin contract/publish jobs and plugin-selected lint use that runtime. #415's two high findings are synthetic newline fixtures; equivalent concatenated fixtures pass the exact v3.12.1 hardcoded-secret detector. Scanner JSON reports are retained without weakening the high-severity gate. #411/#412 were closed as superseded; newest #413 was refreshed, validated and merged. #410 was also refreshed, validated and merged. #415 integrates the action updates and fixes the bounded compiler-test deadline and REST region-field guidance.
- [x] **T3 — Delegation cache lifecycle (P1).** JS/Python caches prune expired credentials, retain at most 128 entries with LRU eviction, and prevent pre-clear exchanges from repopulating the cache. Clear detaches coalescing without cancelling existing consumers; identity guards prevent old completions from removing new exchanges. Concurrency/expiry/eviction regressions pass.
- [x] **T4 — Published Capability clients (P1).** Public OpenAPI `2026-09-29.2` publishes Detail/Query and projection fixtures. JS/Python expose typed methods/models. Paid Query submits once, refuses retry/redirect replay, validates execution fields and retains execution identity for reconciliation. Transport/contract tests and API references are updated. Resolve/selection/idempotency remain external gates.
- [x] **T5 — Adapter compatibility (P2).** Packed SDK runtime/schema/host-identity and TypeScript `ToolSet` checks pass all six AI SDK 5.0.0/6/7 × Zod 3.25.76/4 combinations. Supported ranges are `ai >=5 <8` and `zod ^3.25.76 || ^4`; stable structural tool declarations avoid version-specific fields. CI repeats the matrix and installs CrewAI with a no-skips gate. Isolated CrewAI tests pass locally.
- [x] **T6 — Optional Probe tools (P2).** JS AI and six Python adapters offer opt-in Probe; defaults retain three tools. Host-controlled identity and supported correlation metadata remain outside model input. Conditional guidance explains quote semantics; conformance/schema tests and matching SDK guides are updated.
- [x] **T7 — Issue audit and update drafts (P2).** #200/#228 are stale after merged #294; confidential-client live acceptance remains incomplete. #293 now separates available Detail/Query from missing Resolve/selection/recovery. #368 acceptance is reconciled with dated evidence. Exact proposed body updates are in [maintenance/ISSUE_UPDATES.md](maintenance/ISSUE_UPDATES.md); they have not been posted.

## Python dependency follow-ups

- [x] **#403 — Pydantic AI.** Raise optional/dev floors to 2.46.0; update the graph/transport lock entries. CI checks lock consistency and uses frozen installs for tests, lint and API references.
- [x] **#404 — Tracing and legacy Python.** Resolve SDK 1.45.0 for Python >=3.10, retaining 1.33.1/1.41.1 on 3.8/3.9. Defer client/task/redaction and test annotations that failed on old interpreters. CI runs complete SDK tests on Python 3.8–3.12 with its existing 3.11 coverage gate.
- [x] **#405 — Agents adapter.** Lock 0.22.3 with provider SDK 3.24.0. Resolve CrewAI separately at 1.15.23 with provider SDK 2.45.0 using uv conflicts; a small `test` group runs its 18 native tests without skips.
- [x] **#406 — LangChain.** Align both manifest/lock floors at 0.3.86. Python 3.9 tests the exact floor; modern Python retains its existing 1.4.9 resolution.
- [x] **#407 — Ruff.** Synchronize the 0.16.8 requirement and lockfile; lint and all 71 Python files pass without reformatting. Refresh this checklist and the SDK changelog with the completed fixes.

## Validation evidence

- CLI: 211 tests. MCP: 262 tests including loopback HTTP. Plugin: 130 unit tests plus 31 registry-script tests.
- JS SDK: 187 tests; statement/line coverage above 96%, exceeding its gate.
- The same 187 JS tests also pass on Node 18.20.8 and Node 20; the core SDK release matrix retains Node 18/20/22 and adds 24. Peer-specific consumer tests use their required runtime.
- Python SDK: 720 passed, 2 skipped in the standard dev environment; coverage above 90%, exceeding the 82% gate. Optional CrewAI dependencies account for both skips; isolated CrewAI native integration tests: 18 passing without skips.
- Legacy Python verification: 3.8 has 637 passing tests / 12 unsupported or optional framework skips; 3.9 has 653 / 10. Fresh CI covers 3.8, 3.9, 3.10, 3.11 and 3.12.
- Repository scripts: 99 tests plus 19 validator internal cases. Agent recovery: 24 tests. Packed AI/Zod consumers: six combinations passing.
- Package typechecks, lint, generated API docs, public-copy and locale checks pass.
- Full local scanner v3.12.1 on a clean source copy: score 100, grade A, no findings; the unchanged minimum-score/high-severity thresholds and remote action checks pass.
- [PR #416](https://github.com/QVerisAI/qveris-agent-toolkit/pull/416) implementation commit `7dd9691`: all executable PR checks passed, including locked Python 3.11 CrewAI, six packed peer combinations, OpenClaw packed installs/runtime checks, both scanner runs, generated-doc checks and Windows release-tool tests. Draft-only automatic review steps were skipped as configured.
- Required region/domain scans: no new public-document leaks. Existing matches are historical changelog text or explicitly internal/China-facing documents; cross-domain scan has no matches.
- No paid API execution or production credential was used for verification.

## Remaining external gates

- [x] Fresh PR checks for locked Python 3.11 CrewAI, OpenClaw packed installs and full scanner. Windows SDK/core release matrices still run through scheduled/tag workflows; PR coverage includes Windows release tools.
- [x] Approve/merge independent green dependency PRs #401/#408/#414; close superseded documentation snapshots #411/#412 and retain newest #413. Integrate current main into the maintenance branch and validate its doc generator output.
- [x] Merge reviewed maintenance changes #416; refresh, validate and merge #410/#413 with those source fixes.
- [x] Refresh #415 with action updates, bounded compiler-test deadlines and schema-backed REST guidance. Local JS/script suites pass; the final remote checks, review and merge are recorded in the PR.
- [x] Repair and validate Python dependency PRs #403–#407 with matching lockfiles, legacy-Python conditions and independent framework environments. Exact CI, review and merge outcomes are recorded in the corresponding PRs.
- [ ] Correct the website-owned REST documentation source so future snapshot synchronization preserves the public `execution_restrictions.region_status` and `execution_restrictions.regions` guidance.
- [ ] Apply reviewed issue-body drafts.
- [ ] Registered confidential test client: live delegation success, expiry, wrong-audience and revoke/introspection. Keep credentials outside the repository.
- [ ] Published Resolve, selection freshness, idempotency and execution-lookup contracts before extending recovery.
- [ ] Local Awesome MCP upstream #14435 acceptance, Cursor submission and mcp.so ingestion. Recheck current directory runtime health separately from historical acceptance.
- [ ] Release packages and published surfaces through existing workflows after the remaining review gates pass.
- [x] Merge #417 release-validation tooling: PR/manual workflows test immutable npm archives, wheels and sdists across Linux/Windows; publishing consumes those verified artifacts. Final JS/Python and full contract workflows passed before merge.
- [ ] Validate the final release candidate with PR/manual wheel, sdist and packed
  JS installs, archive checksums and the live acceptance report. Candidate
  validation tooling is implemented; the versioned release and live evidence
  remain separate gates.

## SDK release preparation (2026-10-04)

- [x] Prepare JS SDK 0.9.0 and Python SDK 0.8.0 manifests, matching lockfiles, dated changelogs, guide versions and upgrade notes. This candidate is based on merged #417 (`a2c0c29`). CLI/MCP/plugin versions are unchanged.
- [ ] Re-run automated gates and clean distribution installs on the versioned candidate; record the exact commit and archive checksums in the acceptance report.
- [ ] Confirm a total live-test credit budget, then validate Detail/Probe and at most one deliberate paid Query per SDK, with final usage/ledger reconciliation. The local API key is configured; no credential value is recorded here.
- [ ] Merge the reviewed release preparation PR and revalidate the merged commit before creating individual SDK release tags.
