# Conditional Routing and Capability Reuse Implementation Plan

- Status: proposed implementation contract
- Tracking: QVerisAI/qveris-agent-toolkit#343 and QVerisAI/qveris-agent-toolkit#344
- Evidence: QVerisAI/qveris-agent-harness#101

## Decision

The toolkit will optimize the shortest **safe** path, not the fewest possible tool calls.

- Keep bounded, exact-query, session-scoped capability reuse. The frozen reuse experiment passed every quality, safety, and efficiency gate.
- Do not broaden the current conditional Inspect/Probe guidance yet. The guidance experiment reduced overhead but failed the frozen quality non-inferiority gates.
- Correct provider-comparison and fresh-data behavior, then rerun a new immutable benchmark protocol before broader adoption.

This document is the implementation boundary. A change outside its goals or inside its non-goals requires a separately reviewed issue before implementation.

## Evidence snapshot

The completed deterministic-fixture run contains 132 of 132 planned cells with no infrastructure failures or selective reruns.

The conditional-guidance treatment reduced model-visible tool calls and QVeris HTTP requests by 48.48%, uncached input tokens by 34.90%, and elapsed time by 22.29%. It had no blocking safety event, but it failed quality non-inferiority. Two provider-comparison cells skipped required inspection or probing, and one repeated-date cell did not enter the tool path. Its mean quality score was 97.65 versus 100 for control; the task-cluster confidence bounds also missed the frozen completion, selection, parameter, and scope-freshness margins.

The exact session-reuse treatment preserved 100% measured quality and produced no blocking safety event. It reduced model-visible tool calls and QVeris HTTP requests by 10% and uncached input tokens by 21.96%. This supports the already bounded reuse mode, not fuzzy matching, cross-session memory, or cached business results.

These results are diagnostic evidence from a deterministic local MCP fixture. They do not establish live provider latency, catalog quality, availability, billing behavior, or hosted-service reliability.

## Goals

1. Preserve the efficiency benefit of conditional Inspect and Probe without losing provider-scope, parameter, or freshness accuracy.
2. Preserve and harden exact-query session reuse without replaying user values, results, credentials, or ambiguous executions.
3. Give every toolkit surface the same decision semantics while respecting its existing state model.
4. Make the policy testable through explicit invariants, fault cases, and a frozen benchmark gate.

## Non-goals

- Fuzzy or embedding-based intent matching.
- Cross-session or durable capability memory.
- Making the MCP server or JavaScript/Python SDKs stateful by default.
- Caching business results or answering fresh-data requests from an earlier Call.
- Reusing business parameters merely because a capability is reused.
- Inventing, translating, or moving a `search_id` between discovery contexts.
- Treating a Probe quote as a reservation, authorization, or final price.
- Automatically retrying a paid or side-effecting Call after a timeout, disconnect, redirect, or otherwise unknown execution outcome.
- Adding an unshipped server contract or duplicating server-owned behavior in the toolkit.

## Routing decision contract

Evaluate the current request from top to bottom. A later optimization must never override an earlier safety requirement.

| Current request state | Required action |
| --- | --- |
| User requires a provider, comparison, fallback, coverage check, or source-quality comparison | Discover; Inspect every candidate whose complete current contract or scope is needed before selection; Probe only for current parameter validation or a quote supported by the published Probe contract |
| Capability is unknown, intent/provider/coverage constraints changed, or no valid discovery provenance exists | Discover |
| Parameter contract is omitted, incomplete, stale, or ambiguous | Inspect before Call |
| Parameter contract is explicitly empty and capability scope is otherwise sufficient | Treat as a true zero-parameter capability; do not Inspect only to discover parameters |
| Current parameters require validation, or a current quote is needed for a budget decision | Probe before Call |
| One suitable capability has valid provenance and a complete current contract | Build parameters from the current request and Call |
| Exact normalized query is repeated in the same isolated session and its route/contract remain valid | Reuse capability metadata and provenance; rebuild parameters; Call again when current data is requested |
| Request asks for current, latest, today, or another time-sensitive value | A fresh Call is mandatory; an earlier business result is never sufficient |
| The current action would repeat a Call whose outcome is unknown | Do not replay that attempted Call; report uncertainty and audit by execution identifier when one is safely available. An unrelated request may proceed independently |

### Reference decision procedure

```text
if current_action_would_repeat_call_with_unknown_outcome:
    return report_unknown_without_replay

if provider_comparison_or_fallback_requested:
    discover_candidates
    inspect_candidates_missing_current_scope_or_contract
    probe_only_for_supported_current_validation_or_quote
elif no_exact_valid_route_or_provenance:
    discover_candidates

if selected_contract_is_missing_stale_or_ambiguous:
    inspect_selected_capability

if supported_current_validation_or_quote_is_required:
    probe_selected_capability

parameters = build_from_current_request(selected_current_contract)
call_once(parameters)
```

## State and reuse contract

### Isolation key

Reusable state must be isolated by all of the following boundaries that the host can observe:

- host/tool-factory session;
- API base URL;
- account or authorization-context identity, represented without storing the credential;
- exact normalized discovery query and relevant discovery options such as result limit.

Changing any boundary is a cache miss. Concurrent sessions must not share mutable indexes, discovery provenance, or remembered parameters.

### Allowed state

- capability/tool identifier;
- exact normalized discovery query;
- original discovery identifier and metadata source;
- parameter contract, including the distinction between omitted and explicitly empty;
- acquisition and expiry timestamps;
- non-sensitive capability name/description and successful-use count;
- version or freshness signals actually returned by a published contract.

### Forbidden state

- raw credentials or refresh tokens;
- sensitive user values;
- prior entity, date, location, symbol, or other business parameters for automatic replay;
- prior business results as a substitute for a fresh Call;
- a discovery identifier from another query, endpoint, account, or session;
- inferred availability, price, or contract versions that the source did not provide.

### Freshness classes

Do not make a successful Call renew unrelated metadata.

| State class | Policy |
| --- | --- |
| Exact Discover response | Short TTL; `refresh` bypasses it |
| Capability route hint | Session-scoped bounded TTL; exact intent only |
| Parameter contract | Independent expiry; refresh by Discover or Inspect, never by Call success alone |
| Availability/authorization | Re-evaluate when the authorization context changes or the current task requires it |
| Quote/price | Obtain a current Probe when needed; do not treat an old quote as reserved |
| Business result | Not part of capability reuse; make a fresh Call for current data |

Existing OpenClaw defaults remain 90 seconds for exact Discover caching and 30 minutes for capability memory unless a separately reviewed change provides evidence for different values.

## Surface responsibilities

| Surface | Required implementation boundary |
| --- | --- |
| Agent guidance and skills | Express the decision contract consistently; make provider comparison and fresh Call requirements explicit |
| CLI | Keep the 30-minute last-Discover index only within the exact API endpoint and authorization context that created it; do not present it as semantic memory or a complete schema cache |
| MCP | Keep process/session correlation only; descriptions must not promise route memory |
| JavaScript/Python SDK | Remain stateless by default; expose enough contract information for application-owned policy without hidden persistence |
| OpenClaw plugin | Keep exact-query, tool-factory-session reuse; enforce isolation, provenance, expiry, clear/disable/refresh controls, and current-parameter reconstruction |
| Examples and generated guidance | Demonstrate both the shortest safe path and the conditions that require Inspect or Probe; never hard-code sample business values as user intent |

## Implementation phases

### Phase 1: Freeze and test the policy

- Add one cross-document contract test that asserts the required provider-comparison, fresh-Call, omitted-versus-empty-contract, and unknown-outcome concepts on all maintained guidance surfaces.
- Add forbidden-claim checks for mandatory Probe, unconditional direct Call, cached-result reuse, fuzzy/cross-session memory, and guaranteed Probe price.
- Record the current released behavior as the compatibility baseline; do not change runtime caching in this phase.

Exit condition: the contract test fails when any maintained surface reintroduces one of the known unsafe shortcuts.

### Phase 2: Correct routing guidance

- Require comparison candidates to be inspected when Discover does not contain enough current scope and contract information for a valid comparison.
- Require a fresh Call for time-sensitive requests, including repeats in the same session.
- Preserve direct Discover to Call for a single suitable capability with complete current provenance and contract.
- Keep Probe conditional on parameter validation, a current quote supported by the published contract, or an explicit user preflight. Do not imply that an unsupported Probe check verifies authorization or availability.
- Apply the same semantics to English and Chinese docs, Agent instructions, skills, tool descriptions, adapters, and runnable examples.

Exit condition: deterministic policy tests cover provider comparison, repeated fresh requests, missing contracts, zero-parameter contracts, and safe direct Call.

### Planned change sets

Keep implementation reviewable and do not combine these boundaries in one expanding pull request:

1. **Policy correction:** Agent guidance, LLM-readable files, QVeris skills, maintained client/tool descriptions, runnable examples, paired locale docs, and their cross-document contract tests. Do not change runtime cache behavior.
2. **CLI session isolation:** CLI session/index resolution and focused endpoint, authorization-context, expiry, and explicit-override tests. Preserve the 30-minute shortcut only for an exact context match; do not persist credentials or silently reuse mismatched provenance.
3. **OpenClaw reuse hardening:** OpenClaw cache/config/tool code and focused event-order, isolation, expiry, and fault-injection tests. Do not add fuzzy or durable memory and do not change SDK/MCP state models.
4. **Evidence:** A separately reviewed immutable harness protocol and complete result artifacts. Do not alter toolkit production behavior in the evidence pull request.

Expected toolkit source areas include `agent/`, `skills/qveris*`, client integration/tool-description files, `packages/cli/src/session/`, CLI command/tests that consume the stored session, `packages/openclaw-qveris-plugin/src/`, and matching docs/tests. Generated OpenAPI artifacts, server-owned REST contracts, and SDK transport behavior are excluded unless a separate issue establishes a published contract change.

### Phase 3A: Isolate CLI session shortcuts

- Persist the canonical API endpoint and a non-secret authorization-context binding with each last-Discover session. Never persist an API key, access token, or refresh token in this file.
- Before resolving a numeric tool index or an implicit discovery ID, require both the current endpoint and authorization context to match the stored session.
- Fail closed with a fresh-Discover recovery hint on a mismatch. Do not silently send a stored tool or discovery ID to another endpoint/account.
- Keep an explicit tool ID plus explicit discovery ID independent of the shortcut; both values then come from the current command rather than stored session provenance.
- Cover API-key changes, OAuth login/account changes, OAuth token refresh within the same login context, endpoint changes, expiry, and explicit overrides.

Exit condition: CLI tests prove that stored tool and discovery identifiers cannot cross endpoint or authorization contexts, while a same-context token refresh and explicit current-command identifiers remain usable.

### Phase 3B: Harden bounded OpenClaw reuse

- Test the full isolation key, including API endpoint and authorization-context changes.
- Keep exact-query matching; do not introduce synonym, fuzzy, or embedding matching.
- Ensure route TTL and parameter-contract expiry are independent and Call success does not renew stale contract or quote state.
- Rebuild every Call payload from the current user request and current contract.
- Add concurrency and index-overwrite tests that prove discovery identifiers and parameters cannot cross sessions or queries.
- Preserve explicit refresh, clear, and disable controls.

Exit condition: fault-injection tests show safe misses for expiry, endpoint/account changes, ambiguous scope, stale contracts, and concurrent sessions.

### Phase 4: Cross-client regression and release

- Run all affected CLI, MCP, JavaScript SDK, Python SDK, OpenClaw, documentation, generated-contract, public-copy, build, lint, and type checks.
- Confirm paid Call does not auto-replay on `422`, `429`, `503`, redirects, transport loss, or unknown outcome unless the response explicitly proves execution did not occur and the existing contract marks the retry safe.
- Update versions and changelogs only for packages whose published behavior or public guidance changes.
- Record exact package versions used by downstream documentation synchronization.

Exit condition: the complete repository gate passes and the release diff contains no unrelated cache or routing expansion.

### Phase 5: Frozen reevaluation

- Create a new immutable benchmark task/fixture version before observing its treatment results.
- Retain the existing control and change only the routing guidance under evaluation.
- Include provider comparison, exact repeat, different-entity repeat, different-date repeat, fresh-data wording, missing/empty contracts, expiry, endpoint/account change, and unknown paid outcome clusters.
- Run the complete planned matrix with one pinned model/runtime configuration, no selective reruns, and sanitized artifacts.

Broader guidance adoption requires every frozen gate:

- zero `cache_mismatch`, `cross_authorization_reuse`, `duplicate_paid_execution`, and `unknown_execution_replay` events;
- quality-score task-cluster 95% lower confidence bound no worse than -3 points;
- completion, selection, parameter, and scope-freshness lower bounds no worse than -5 percentage points each;
- no increase in provider attempts;
- task-cluster 95% upper confidence bound is non-positive for each claimed primary efficiency improvement;
- at least 10% practical improvement in a claimed primary efficiency metric, with no primary metric regressing by more than 10%;
- 100% planned-cell completion, one runtime identity, no selective reruns, and no unsanitized identifiers or credentials in public artifacts.

If any quality or safety gate fails, keep the conservative production policy and open a narrowly scoped follow-up. Do not relax a frozen margin after seeing the result.

## Required test and fault matrix

| Cluster | Minimum assertion |
| --- | --- |
| Direct path | Complete single-capability contract reaches one Call without unnecessary Inspect/Probe |
| Provider comparison | Missing candidate scope/contract triggers inspection before selection |
| Current data | Repeated current/latest/date-sensitive request makes a fresh Call |
| Parameter reconstruction | Same capability with a different entity/date never reuses old business values |
| Contract shape | Omitted contract triggers Inspect; explicit empty contract remains zero-parameter |
| Expiry | Expired route or contract cannot be treated as current |
| Isolation | Endpoint, account/authorization context, query, and session changes cannot hit old state |
| Provenance | A `search_id` remains attached only to its original valid discovery context |
| Price and authorization | Old quote is not a reservation; changed authorization forces re-evaluation |
| Concurrency | Parallel sessions and overwritten numeric indexes cannot cross-wire tools or parameters |
| Paid failure | `422/429/503`, redirects, timeout, disconnect, and unknown execution do not cause an unsafe automatic replay |
| Controls | Refresh bypasses Discover cache; clear and disable remove reuse behavior |

## Observability and privacy

Tests and optional low-sensitivity telemetry may record decision reason codes such as `route_reused`, `inspect_missing_contract`, `inspect_provider_comparison`, `probe_current_quote`, and `fresh_call_required`. They must not record raw credentials, business payloads, full results, discovery/execution identifiers, or an ordered private catalog in public artifacts.

Measure these separately:

- model-visible tool calls;
- QVeris HTTP requests;
- provider attempts;
- uncached input tokens;
- elapsed time;
- completion, selection, parameter, and scope-freshness accuracy;
- blocking safety events.

Do not summarize them as one generic cache-hit or success-rate number.

## Change-control checklist

Before implementation or review, confirm:

- [ ] The diff stays inside this plan and does not add semantic or cross-session memory.
- [ ] Provider comparison and fresh-data rules cannot be bypassed by cache reuse.
- [ ] Business parameters and results are reconstructed or fetched for the current request.
- [ ] State isolation and provenance invariants have event-order and fault-injection tests.
- [ ] English and Chinese maintained surfaces are aligned.
- [ ] Public documentation boundary checks pass.
- [ ] Package version/changelog changes match the actual published surface.
- [ ] The benchmark protocol and margins were frozen before the formal run.
- [ ] Failed formal gates result in rollback or a narrower follow-up, not post-hoc threshold changes.
