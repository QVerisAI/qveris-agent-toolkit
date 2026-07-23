# Discover → Call benchmark

This directory contains the reproducible evaluation harness tracked by issue
#163. It measures whether an agent can use the public QVeris workflow correctly,
without assuming that one catalog tool ID is the only valid answer.

New runs use benchmark methodology `discover-call-v2`. Version 2 checks the
payload inside full execution-result wrappers and uses exact ordered composite
constraint matching. Historical v1 artifacts remain verifiable but must not be
mixed with v2 in one summary.

## Scope boundary

This harness deliberately stays at the contract level: deterministic scoring of
the public discover → inspect → call workflow, cheap enough to re-run per
release and reproducible by anyone with an API key. It is the public instrument
for published routing-layer numbers.

Domain-level evaluation — long-horizon professional tasks, judged scoring,
with/without-QVeris product comparisons — is a different instrument and is out
of scope here. Do not grow this directory in that direction; new tasks belong
in a versioned task-set revision (`tasks/v2.jsonl`, …) only if they still score
deterministically at the contract level.

## What is measured

Each task runs the same sequence:

1. `discover` with a fixed natural-language query.
2. Ask a model adapter to select one returned tool.
3. `inspect` the selected tool.
4. Ask the adapter to construct parameters from the inspected schema.
5. Optionally execute the billed `call`.

The runner treats both grounding checks as execution gates: it stops before
`inspect` when selection is outside the discovery results, and stops before
parameterization or `call` when inspection does not return the exact selected
tool. It validates the complete task set, including unique task and constraint
identifiers, before the first external request so malformed input cannot leave
a partial billed run.

The scorer reports these metrics separately:

- **selection grounded**: the selected tool was returned by `discover`;
- **inspection grounded**: `inspect` returned the selected tool;
- **required-parameter accuracy**: fraction of required schema parameters supplied;
- **constraint accuracy**: fraction of task facts represented through accepted parameter aliases;
- **call success**: successful real executions among attempted calls;
- **result non-empty**: successful calls returned a structurally non-empty
  `result.data` (or non-empty truncated-content evidence); this does not assert
  semantic correctness;
- **workflow success**: all preceding checks equal 100%, the real call succeeds,
  and its result is non-empty.

Discover and inspect retry `429` and `503` responses, transient network
failures, and response-body timeouts. Execute retries only an explicit `429`;
it does not retry `503`, network errors, or timeouts because the first request
may already have produced third-party side effects or a charge. Calls explicitly
request `respond_with: "full"` so structural result scoring does not depend on
a changing server default. The summary assigns each observed strict failure to
its earliest failed gate and reports normalized stage/reason counts; all
exhausted API failures remain in the strict workflow-success denominator.
Legacy successful calls without result-non-emptiness evidence remain
unreportable rather than being relabeled as failures.

The summary includes a deterministic 95% task-cluster bootstrap interval for
workflow success. Tasks, rather than individual trials, are resampled so three
trials of one task are not treated as three independent task draws. Dry runs
never count as workflow success. A successful legacy call with no recorded
result-content observation is reported as unknown; it is never inferred to have
a non-empty result or included in a strict workflow point estimate.

## Task sets

Task sets are versioned and immutable once referenced by a published result:

- `tasks/v1.jsonl` — 6 tasks (initial smoke-scale set).
- `tasks/v2.jsonl` — 18 tasks (supersedes v1 as the reference set): the v1 six
  unchanged, plus geocoding, IP geolocation, crypto price, web search, air
  quality, market news, domain intelligence, image search, market holidays,
  earthquake catalog, company fundamentals, and sports standings. Every added
  task was verified against the live catalog: its `discover_query` returns
  multiple parameterizable capabilities within the default discovery limit,
  and constraint aliases were taken from the actual parameter names of those
  capabilities.
- `tasks/v3.jsonl` — a diagnostic comparison set. It added deterministic
  reference candidates and task-specific normalization, but its crypto
  constraint did not recognize CoinMarketCap's provider-specific Bitcoin
  identifier `id=1`.
- `tasks/v4.jsonl` — the current immutable quality-baseline contract. It copies
  v3 and explicitly accepts `id=1` only for the crypto task's `id` alias.
  This task-versioned mapping fixes the known v3 scoring false negative without
  retroactively changing v3. Provider-specific `alias_values` use exact
  matching even when the human-readable constraint uses `contains`.

New tasks land as a new `tasks/vN.jsonl` revision, never by editing an
existing file, and must still score deterministically at the contract level.
Select the set with `--tasks`; the scorer refuses to aggregate records across
different task-set hashes.

## Run

Set `QVERIS_API_KEY`, then provide an adapter executable and a model identifier.
Use `--lane pinned-model` only when the provider exposes a verifiable immutable
model revision and record it with `--model-revision`. Otherwise use
`configured-model` or `current-model` and record `unreported`.
The adapter command is spawned directly without shell parsing.
The harness removes every `QVERIS_*` variable from the adapter environment;
the bundled adapters repeat that boundary before starting their model CLI.
Adapters must use separately named credentials for their model provider.
The runner requires an explicit immutable task file and comparison lane. It
records a commit-shaped toolkit revision and refuses to run from a checkout
with tracked changes, including when `--toolkit-revision` is supplied.

```bash
node src/run.mjs \
  --model provider/model-version \
  --lane configured-model \
  --tasks tasks/v4.jsonl \
  --adapter node \
  --adapter-arg /absolute/path/to/model-adapter.mjs \
  --adapter-revision adapter-git-sha-or-config-hash \
  --trials 3 \
  --execute \
  --output runs/model-version.jsonl
```

`--execute` performs billed calls. Omit it while validating an adapter, but do
not publish dry-run records as benchmark results. Each trial atomically
checkpoints the private output file so an interrupted paid run retains all
records completed before the interruption; a partial checkpoint still fails
official publication completeness checks.

Within a trial, Discover, Inspect, and Execute share an independent private
`session_id`, and Execute also records the model identifier in the API request.
The session id is not derived from the public run id, sent to the model adapter,
or retained in public artifacts. The model identifier remains part of the
benchmark's public reproducibility metadata.

### Comparison lanes

Use the lanes together; none is a substitute for the others:

- `reference` is a curated reference route for the fixed discovery query. The
  deterministic adapter selects only a configured candidate that appears in the
  observed Top 10 and supplies fixed parameters. It represents only those
  curated candidates; a task with no suitable returned candidate remains a
  strict failure.
- `configured-model` measures a named model plus recorded CLI, reasoning, adapter,
  and task-set configuration when an immutable provider snapshot is unavailable.
- `pinned-model` measures longitudinal changes with one immutable model,
  provider revision, reasoning configuration, CLI, adapter revision, and task
  set. The runner rejects this lane without `--model-revision`.
- `current-model` measures the currently recommended model under the same task
  contract.
- `model` is retained for backward-compatible records that predate explicit
  lanes; the v2 runner does not accept it for new runs.

The strict benchmark gap is
`curated reference route workflow success - model workflow success`.
Compare component metrics and failure reasons alongside it so discovery
coverage, model routing, parameter construction, execution, and result non-emptiness
are not collapsed into one diagnosis. Here, result non-emptiness is structural,
not a semantic-quality judgment.

Run the curated reference route with the same task file supplied both to the
harness and adapter:

```bash
node src/run.mjs \
  --model reference-v1 \
  --model-revision deterministic-reference-v1 \
  --lane reference \
  --adapter node \
  --adapter-arg "$PWD/adapters/reference.mjs" \
  --adapter-arg "$PWD/tasks/v4.jsonl" \
  --adapter-revision toolkit-git-sha/reference-v1 \
  --tasks tasks/v4.jsonl \
  --trials 3 \
  --execute \
  --output runs/reference-v1.raw.jsonl
```

Generate public artifacts from raw records:

```bash
npm run publish -- \
  --tasks tasks/v4.jsonl \
  --runs runs/model-version.raw.jsonl \
  --output-runs results/model-version-v4.runs.jsonl \
  --output-summary results/model-version-v4.summary.json
```

Keep raw records outside the public repository. Publication removes operational
identifiers and the ordered discovery catalog, adds count/digest attestations,
hashes selected tools that are not explicitly approved, and replaces raw
parameter values with required-parameter and constraint-accuracy attestations.
Inspected parameter names are omitted so a hashed tool cannot leak schema
details.

Validate the checked-in task set, fixtures, and scorer:

```bash
npm test
npm run validate
```

## Adapter protocol

The harness invokes the adapter once per decision stage. It writes one JSON
object to stdin and expects exactly one JSON object on stdout. Each request
contains the immutable `task_set_sha256`, canonical `messages`, and a
`response_schema`; model adapters must send the messages and schema unchanged
so model comparisons use the same prompt and output contract. The bundled
reference adapter rejects a task-file digest mismatch. Ground-truth scoring
constraints are deliberately not exposed to model adapters.

Selection input uses `stage: "select"`; `input` contains the user prompt and
compact routing cards. The operational `search_id` and non-routing discovery
metadata are not sent to the model adapter. Return:

```json
{"tool_id":"selected.tool.id"}
```

Parameterization input uses `stage: "parameterize"`; `input` contains the same
user prompt and a least-privilege projection of the inspected `selected_tool`
(`tool_id`, descriptive fields, parameters, one-of requirements, and examples).
The discovery id, billing metadata, runtime statistics, and prior-execution
records are not sent to the model adapter. Return:

```json
{"parameters":{"city":"London"}}
```

For parameterization, the harness derives a strict response schema from the
inspected tool's parameter metadata. Every known parameter is represented;
optional parameters are nullable because strict structured-output providers
require every declared property to appear. The harness removes top-level null
values before scoring and execution, so omitted optional parameters retain
their normal API semantics. Because the public inspection contract does not
describe array items or object properties, an opaque optional array/object is
forced to `null`, while an opaque required array/object fails before model
parameterization or a billed call.

When multiple constraints share a composite alias such as `symbol` or `pair`,
the scorer accepts only an exact, ordered composite representation (for
example, `USD/EUR`, `USD-EUR`, or `USDEUR`). Reversed pairs and substring
matches do not satisfy the constraints.

Adapters may call any model provider, but must not alter canonical messages or
print prompts, keys, tokens, or provider error bodies to stdout. A first-result
heuristic adapter is included only as a transport example; it does not construct
parameters and is not an official model result.

### Codex CLI adapter

`adapters/codex-cli.mjs` supports authenticated Codex CLI installations. It
maps the canonical system message to `developer_instructions`, sends the
canonical user message unchanged on stdin, and writes the unchanged response
schema to a temporary file for `--output-schema`. The adapter uses an ephemeral
session in an isolated temporary directory, ignores user configuration and
rules, uses a read-only sandbox, and rejects runs that emit tool-use events.
Reasoning effort is fixed at `medium`; record the exact Codex CLI version
alongside the adapter commit in `--adapter-revision`:

```bash
node src/run.mjs \
  --model gpt-5.6-sol \
  --lane configured-model \
  --adapter node \
  --adapter-arg "$PWD/adapters/codex-cli.mjs" \
  --adapter-revision adapter-git-sha/codex-cli-0.144.1/medium \
  --tasks tasks/v2.jsonl \
  --trials 3 \
  --execute \
  --output runs/gpt-5.6-sol.jsonl
```

The adapter reuses the CLI's existing authentication and never receives
`QVERIS_API_KEY` (both the harness and adapter remove it from the model
subprocess environment).

### Claude CLI adapter

`adapters/claude-cli.mjs` remains available for authenticated Claude CLI
installations. It passes the canonical system message as `--system-prompt`, the
canonical user message on stdin, and the unchanged response schema through
`--json-schema`. Safe mode disables project customizations, tools are disabled,
and sessions are not persisted, so the run measures only the supplied benchmark
messages. Use a full model identifier rather than an alias:

```bash
node src/run.mjs \
  --model claude-sonnet-5 \
  --lane configured-model \
  --adapter node \
  --adapter-arg "$PWD/adapters/claude-cli.mjs" \
  --adapter-revision adapter-git-sha \
  --tasks tasks/v2.jsonl \
  --trials 3 \
  --execute \
  --output runs/claude-sonnet-5.jsonl
```

The adapter uses the CLI's existing authentication and never receives
`QVERIS_API_KEY` (the harness strips it from the adapter environment).

## Publication rules

An official result must include:

- sanitized public JSONL records and generated summary; raw records remain
  private;
- the toolkit commit SHA and the exact, unchanged task-set file used (e.g. `tasks/v2.jsonl`);
- the model identifier and provider revision (or explicit `unreported`), adapter
  source revision, runtime, trial count, and date;
- the recorded API base URL, observed API revision, catalog revision when
  reported, catalog-observation SHA-256, discovery limit, and task-set SHA-256;
- at least three trials per task;
- `--execute` records for every reported workflow-success denominator;
- failures retained in the denominator; no selective reruns or task removal;
- no API keys, access tokens, parameter values, private prompts, raw provider error bodies,
  execution/search/connection identifiers, or unfiltered catalog results.

The scorer rejects missing tasks, unequal trial counts, duplicate trials, and
non-consecutive trial numbering for every model. It also rejects duplicate run
IDs and aggregation across different adapter, toolkit, task-set, endpoint,
discovery-limit, or execution settings.
The checked-in-artifact validator also verifies the exact task-set digest,
requires real execution and at least three trials per task, and rejects fields
outside the public artifact schema.

The catalog and artifact visibility boundary is defined in
[`PUBLICATION_POLICY.md`](PUBLICATION_POLICY.md). Until discovery reports
per-tool visibility, bulk catalog content defaults to private; only approved
selected tool IDs may appear in public benchmark records. Other selected tools
are represented only by a digest.

The checked-in fixture validates the scorer only. It is synthetic and must not
be presented as product performance.
