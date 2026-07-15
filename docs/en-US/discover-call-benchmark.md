# Discover → Call accuracy benchmark

QVeris evaluates the complete agent workflow instead of publishing an
unverifiable adjective or scoring only search relevance. The public harness is
in [`benchmarks/discover-call`](../../benchmarks/discover-call/README.md).

## Methodology

For every task and model trial, the harness runs `discover`, asks the model to
select a returned capability, runs `inspect`, asks the model to construct
parameters from the current schema, and then performs a real `call` when
execution is enabled.

The scorer publishes grounded selection, grounded inspection, required-parameter
accuracy, task-constraint accuracy, call success, and strict end-to-end workflow
success. Workflow success requires every component to pass and therefore cannot
be reported from dry runs. The aggregate includes a 95% Wilson interval.
Transient `429` and `503` responses are retried first; exhausted API failures
remain in the denominator and are reported separately by failure stage.

The task set uses semantic parameter aliases rather than a single fixed tool ID.
This avoids penalizing a model for selecting a different capability that fulfills
the same task while still requiring its choice to come from the actual discovery
response. Model adapters receive canonical messages and a response schema but
never receive the scorer's ground-truth constraints.

## Reproducibility requirements

Published results must retain failures, use at least three trials per task, name
an immutable model version and adapter revision, record the toolkit commit, and
include raw JSONL records plus the generated summary. Credentials and raw
provider error bodies must never be published.

## Published results

No official model result is published yet. The repository currently includes a
synthetic scorer fixture only; it is not a product-performance claim. The first
controlled run will be added with raw records and the exact methodology metadata
before any accuracy percentage is advertised.
