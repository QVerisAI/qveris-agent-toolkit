# Discover → Call benchmark

This directory contains the reproducible evaluation harness tracked by issue
#163. It measures whether an agent can use the public QVeris workflow correctly,
without assuming that one catalog tool ID is the only valid answer.

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

The scorer reports these metrics separately:

- **selection grounded**: the selected tool was returned by `discover`;
- **inspection grounded**: `inspect` returned the selected tool;
- **required-parameter accuracy**: fraction of required schema parameters supplied;
- **constraint accuracy**: fraction of task facts represented through accepted parameter aliases;
- **call success**: successful real executions among attempted calls;
- **workflow success**: all preceding checks equal 100% and the real call succeeds.

The transport retries `429` and `503` responses before recording an API-stage
failure, matching the public clients' transient-failure behavior. The summary
reports failures by stage; all exhausted API failures remain in the strict
workflow-success denominator.

The summary includes a 95% Wilson interval for workflow success. Dry runs never
count as workflow success, so a published success rate cannot be produced
without exercising the full workflow.

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

New tasks land as a new `tasks/vN.jsonl` revision, never by editing an
existing file, and must still score deterministically at the contract level.
Select the set with `--tasks`; the scorer refuses to aggregate records across
different task-set hashes.

## Run

Set `QVERIS_API_KEY`, then provide an adapter executable and an immutable model
identifier. The adapter command is spawned directly without shell parsing.
The harness removes `QVERIS_API_KEY` from the adapter environment; adapters
must use separately named credentials for their model provider.

```bash
node src/run.mjs \
  --model provider/model-version \
  --adapter node \
  --adapter-arg /absolute/path/to/model-adapter.mjs \
  --adapter-revision adapter-git-sha-or-config-hash \
  --trials 3 \
  --execute \
  --output runs/model-version.jsonl
```

`--execute` performs billed calls. Omit it while validating an adapter, but do
not publish dry-run records as benchmark results.

Score the records:

```bash
node src/score.mjs \
  --runs runs/model-version.jsonl \
  --output runs/model-version.summary.json
```

Validate the checked-in task set, fixtures, and scorer:

```bash
npm test
npm run validate
```

## Adapter protocol

The harness invokes the adapter once per decision stage. It writes one JSON
object to stdin and expects exactly one JSON object on stdout. Each request
contains canonical `messages` and a `response_schema`; model adapters must send
both unchanged so model comparisons use the same prompt and output contract.
Ground-truth scoring constraints are deliberately not exposed to adapters.

Selection input uses `stage: "select"`; `input` contains the user prompt and the
complete discovery response. Return:

```json
{"tool_id":"selected.tool.id"}
```

Parameterization input uses `stage: "parameterize"`; `input` contains the same
user prompt and the inspected `selected_tool`. Return:

```json
{"parameters":{"city":"London"}}
```

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

- the raw JSONL records and generated summary;
- the toolkit commit SHA and the exact, unchanged task-set file used (e.g. `tasks/v2.jsonl`);
- an immutable model version, adapter source revision, trial count, and date;
- the recorded API base URL, discovery limit, and task-set SHA-256;
- at least three trials per task;
- `--execute` records for every reported workflow-success denominator;
- failures retained in the denominator; no selective reruns or task removal;
- no API keys, access tokens, private prompts, or raw provider error bodies.

The scorer rejects missing tasks, unequal trial counts, duplicate trials, and
non-consecutive trial numbering for every model. It also rejects duplicate run
IDs and aggregation across different adapter, toolkit, task-set, endpoint,
discovery-limit, or execution settings.

The checked-in fixture validates the scorer only. It is synthetic and must not
be presented as product performance.
