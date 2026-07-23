# Discover → Call accuracy benchmark

QVeris evaluates the complete agent workflow instead of publishing an
unverifiable adjective or scoring only search relevance. The public harness is
in [`benchmarks/discover-call`](../../benchmarks/discover-call/README.md).

This benchmark is scoped to the contract level: deterministic, per-release
scoring of the public discover → inspect → call workflow, reproducible by
anyone with an API key. Domain-level evaluation of long-horizon professional
tasks with judged scoring is a separate instrument and is intentionally not
part of this harness.

## Methodology

For every task and model trial, the harness runs `discover`, asks the model to
select a returned capability, runs `inspect`, asks the model to construct
parameters from the current schema, and then performs a real `call` when
execution is enabled.

The scorer publishes grounded selection, grounded inspection, required-parameter
accuracy, task-constraint accuracy, call success, and strict end-to-end workflow
success. A successful call must also return a non-empty result to satisfy the
result-validity and strict-workflow gates. Workflow success requires every
component to pass and therefore cannot be reported from dry runs. The aggregate
includes a 95% Wilson interval and safe failure counts by stage and reason.
Transient `429` and `503` responses are retried first; exhausted API failures
remain in the denominator and are reported separately by failure stage.

The task set uses semantic parameter aliases rather than a single fixed tool ID.
This avoids penalizing a model for selecting a different capability that fulfills
the same task while still requiring its choice to come from the actual discovery
response. Model adapters receive canonical messages and a response schema but
never receive the scorer's ground-truth constraints.

The v3 task set adds explicit handling for combined parameters such as
`symbol=USD/EUR` and opt-in URL decoding, without changing the historical v2
scoring contract. It also supports three complementary comparison lanes:

- the deterministic Oracle lane measures the current platform ceiling by
  selecting a fixed valid candidate only when it appears in the query's Top 10;
- the pinned-model lane measures changes over time with an immutable model and
  adapter configuration;
- the current-model lane measures the currently recommended model.

The difference between Oracle and model strict-workflow success is the routing
gap. Component metrics and failure reasons identify whether the remaining loss
comes from discovery coverage, model routing, parameter construction,
execution, or result validity.

## Reproducibility requirements

Published results must retain failures, use at least three trials per task, name
an immutable model version and adapter revision, record the toolkit commit, and
include raw JSONL records plus the generated summary. Credentials and raw
provider error bodies must never be published.

## Published results

The v3 comparison was run on 2026-07-23 with three trials per task and real
execution. The deterministic Oracle measures the current fixed-query platform
ceiling; the pinned model uses `gpt-5.6-sol`, medium reasoning effort, and Codex
CLI 0.144.1.

| Metric | Oracle | Pinned model |
| --- | ---: | ---: |
| Completed and executed | 51 / 54 | 52 / 54 |
| Constraint accuracy | 94.44% | 83.33% |
| Call and non-empty-result success | 100% (51 / 51) | 88.46% (46 / 52) |
| Strict workflow success | 94.44% (51 / 54) | 72.22% (39 / 54) |
| Workflow success, 95% Wilson interval | 84.89%–98.09% | 59.11%–82.38% |

The strict routing gap is 22.22 percentage points. The Oracle's only failures
were the three Tokyo-timezone trials, where the fixed query returned no Top 10
capability accepting a city or coordinates. The pinned model had the same three
semantic misses, six selected-tool execution failures, two safely classified
disabled-tool attempts, and additional strict constraint misses. Three
successful Bitcoin calls used CoinMarketCap's numeric `id=1`; because the v3
constraint expects a value containing `BTC`, they remain known identifier-mapping
false negatives rather than being reclassified after the run.

See the [result notes, immutable revisions, raw JSONL, and generated
summary](../../benchmarks/discover-call/results/README.md). The synthetic scorer
fixture remains test-only and is not a product-performance claim. The original
v2 result remains preserved there as a historical baseline under its original
scoring contract.
