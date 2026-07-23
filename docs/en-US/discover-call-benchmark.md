# Discover → Call accuracy benchmark

QVeris evaluates the complete agent workflow instead of scoring search
relevance alone. The public harness is in
[`benchmarks/discover-call`](../../benchmarks/discover-call/README.md).

This benchmark stays at the contract level: it measures the public discover →
inspect → call workflow with deterministic scoring and real executions.
Long-horizon, judged domain evaluations are a separate instrument.

## Methodology

For every task and trial, the harness runs `discover`, asks the adapter to
select a returned capability, runs `inspect`, asks the adapter to construct
parameters from the current schema, and performs a real `call`.
Selection outside the discovery results and inspection that omits the exact
selected capability are hard gates, so no later inspect, parameterization, or
billed call crosses an ungrounded step.

The scorer reports grounded selection and inspection, required-parameter
accuracy, task-constraint accuracy, call success, structural result
non-emptiness, and strict end-to-end workflow success. Non-empty does not mean
semantically correct. Dry runs never count as workflow success. The 95%
interval uses task-cluster bootstrap resampling so repeated trials of one task
are not treated as independent task draws.

Task sets use semantic parameter aliases rather than one fixed tool ID. Model
adapters receive canonical messages and a response schema, but never the
scorer's ground-truth constraints.

The comparison lanes are:

- `reference`: a curated reference route that uses a fixed candidate only when
  it appears in the observed Top 10. It represents those candidates, not every
  possible platform route.
- `configured-model`: a recorded model, CLI, reasoning, adapter, and task-set
  configuration when the provider does not expose a verifiable immutable model
  revision.
- `pinned-model`: reserved for a provider model revision that can be verified
  as immutable; the runner requires `--model-revision`.
- `current-model`: the currently recommended model under the same task
  contract.

The difference between reference and model strict-workflow success is the
**strict benchmark gap**. It is not automatically a pure routing effect:
sequential lanes can observe different live catalog snapshots. Component
metrics, failure reasons, API revision, and catalog-observation digests must be
considered with it.

## Reproducibility and publication

Published results retain every failed trial and use at least three trials per
task. They record the model identifier and provider revision (or
`unreported`), adapter and toolkit revisions, task-set digest, runtime, API
revision, catalog revision when reported, catalog-observation digest, endpoint,
and discovery limit.

Only sanitized JSONL is committed. Public artifacts omit execution, search,
session, and connection identifiers, raw parameter values, and the ordered
discovery catalog. Approved selected tool IDs may remain visible; other
selected tools are represented only by a digest. Parameter quality is published
only as required-parameter and constraint-accuracy attestations; inspected
parameter names are omitted so hashed tools do not leak schema details. See the
[publication policy](../../benchmarks/discover-call/PUBLICATION_POLICY.md).

## Published results

The 2026-07-23 v4 run is a **diagnostic baseline candidate**, not an official
quality baseline. It covers 18 immutable tasks, three trials each, with real
calls, but a later collector audit found that result non-emptiness was tested
against the full `result` wrapper instead of `result.data`. A wrapper containing
empty data could therefore be recorded as non-empty. Raw result bodies were
intentionally not retained, so the affected attestations cannot be recomputed.

| Historical diagnostic | Curated reference route | `gpt-5.6-sol` configured model |
| --- | ---: | ---: |
| Completed and executed | 51 / 54 | 51 / 54 |
| Constraint accuracy | 94.44% | 88.89% |
| Call success | 100% (51 / 51) | 88.24% (45 / 51) |
| Wrapper-level non-empty observation | 100% (51 / 51) | 88.24% (45 / 51) |
| Strict workflow output | 94.44% (51 / 54) | 77.78% (42 / 54) |
| Workflow interval | 83.33%–100% | 55.56%–94.44% |

The historical strict benchmark gap output is 16.66 percentage points. It must
not be presented as a current quality or routing baseline. The reference
route's three diagnostic failures are Tokyo-timezone coverage misses. The
configured model's 12 diagnostic strict failures are three Tokyo constraint
misses, three IP lookup call failures, three company-profile call failures, and
three safely classified `tool_use_rejected` adapter failures.

The configured lane used `gpt-5.6-sol`, medium reasoning, and Codex CLI 0.144.1.
Its provider model revision is `unreported`, so this is not presented as a
pinned model snapshot. Both lanes observed API revision `2026-07-22.1`; the API
did not report a catalog revision, and the separate catalog-observation digests
differ.

Promotion requires a fresh run under the corrected collector, which now checks
`result.data`, requests the full result projection, prevents ambiguous Execute
retries, and pins the reproducibility inputs before the first external call.
The earlier v3 run is also retained only as a diagnostic baseline. Its three
successful Bitcoin calls used provider-specific `id=1`, which v3 incorrectly
scored as constraint failures. Immutable `tasks/v4.jsonl` explicitly recognizes
that mapping, and all three Bitcoin trials pass in v4.

See the [result notes, revisions, sanitized JSONL, and generated
summaries](../../benchmarks/discover-call/results/README.md). The synthetic
scorer fixture remains test-only and is not a product-performance claim.
