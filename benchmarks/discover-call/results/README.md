# Published benchmark results

## 2026-07-23 — v3 diagnostic comparison

This diagnostic run compares the curated reference route and a configured model
over the same 18 tasks, three trials per task, Top 10 discovery limit, and real
QVeris calls. No failed trial was removed or selectively rerun. It is not the
official quality baseline because v3 has a known Bitcoin constraint-scoring
false negative.

| Metric | Curated reference route | `gpt-5.6-sol` configured model |
| --- | ---: | ---: |
| Runs | 54 | 54 |
| Completed and executed | 51 / 54 | 52 / 54 |
| Selection grounded | 94.44% | 100% |
| Inspection grounded | 94.44% | 100% |
| Required-parameter accuracy | 100% | 100% |
| Constraint accuracy | 94.44% | 83.33% |
| Call success among attempted calls | 100% (51 / 51) | 88.46% (46 / 52) |
| Non-empty result among attempted calls | 100% (51 / 51) | 88.46% (46 / 52) |
| Strict workflow success | 94.44% (51 / 54) | 72.22% (39 / 54) |
| Workflow success, 95% task-cluster bootstrap | 83.33%–100% | 50.00%–88.89% |

The v3 strict benchmark gap is **22.22 percentage points**: curated reference
route 94.44% minus configured model 72.22%. It includes three Bitcoin false
negatives: successful non-empty calls used the provider-specific `id=1`, while
v3 accepted only values containing `BTC`. Therefore this gap is diagnostic,
not a publishable model-routing delta.

Shared reproducibility metadata:

- toolkit revision: `5006c2a0789e2352944ffd87b1a154b96ec0566f`
- task set: `tasks/v3.jsonl`
- task-set SHA-256:
  `d1e18b3affdecd65c09b632ab476b907d09b46ac11718d9aa92156bd0d6f8866`
- API base URL: `https://qveris.ai/api/v1`
- API revision: `unreported` (the legacy runner did not capture it)
- catalog revision: `unreported`
- discovery limit: `10`

Curated-reference metadata:

- legacy model identifier: `oracle-v1`
- published lane: `reference`
- adapter revision:
  `5006c2a0789e2352944ffd87b1a154b96ec0566f/oracle-v1`

Configured-model metadata:

- model: `gpt-5.6-sol`
- lane: `configured-model`
- provider model revision: `unreported`; no immutable snapshot claim is made
- reasoning effort: `medium`
- Codex CLI: `0.144.1`
- adapter revision:
  `5006c2a0789e2352944ffd87b1a154b96ec0566f/codex-cli-0.144.1/medium`

Artifacts:

- [`2026-07-23-oracle-v1-v3.runs.jsonl`](2026-07-23-oracle-v1-v3.runs.jsonl)
- [`2026-07-23-oracle-v1-v3.summary.json`](2026-07-23-oracle-v1-v3.summary.json)
- [`2026-07-23-gpt-5.6-sol-v3.runs.jsonl`](2026-07-23-gpt-5.6-sol-v3.runs.jsonl)
- [`2026-07-23-gpt-5.6-sol-v3.summary.json`](2026-07-23-gpt-5.6-sol-v3.summary.json)

### v3 diagnostic interpretation

The curated reference route's three strict failures are all `timezone-tokyo`:
the fixed discovery query returned no Top 10 capability that accepts a city or
coordinates. All 51 reference-selected calls succeeded and returned non-empty
results.

The configured model also missed Tokyo semantically in all three trials: it
selected a successful timezone-list capability with no Tokyo input. Six well-formed
calls returned `success: false`: three selected
`weather_api.ip_lookup.retrieve.v1.e095d904`, and three selected
`tradefeeds.compinfo.retrieve.v1.c2314765`. Two domain-intelligence
parameterization attempts were rejected because the isolated model session
tried to use a disabled external tool; the remaining trial called the selected
tool with `{}` and therefore missed the domain constraint.

Three cryptocurrency calls succeeded and returned non-empty Bitcoin results via
CoinMarketCap's provider-specific numeric `id=1`, but the deterministic task
constraint expects a parameter value containing `BTC`; these remain strict
constraint misses rather than being silently reclassified after the run. This
known identifier-mapping limitation is fixed in immutable `tasks/v4.jsonl`.
The v3 records remain unchanged in meaning.

## 2026-07-23 — `gpt-5.6-sol` historical v2 baseline

This is the first controlled result for the versioned `tasks/v2.jsonl` contract
benchmark. It contains 18 tasks, three trials per task, and real QVeris calls.
No failed trial was removed or selectively rerun.

| Metric | Result |
| --- | ---: |
| Runs | 54 |
| Completed and executed | 50 / 54 |
| Selection grounded | 100% |
| Inspection grounded | 100% |
| Required-parameter accuracy | 100% |
| Constraint accuracy | 75.93% |
| Call success among attempted calls | 88.00% (44 / 50) |
| Strict workflow success | 64.81% (35 / 54) |
| Workflow success, 95% task-cluster bootstrap | 42.59%–85.19% |

Reproducibility metadata:

- model: `gpt-5.6-sol`
- reasoning effort: `medium`
- Codex CLI: `0.144.1`
- adapter revision:
  `72672d22f3852349e166ab930efa3617945d82f0/codex-cli-0.144.1/medium`
- toolkit revision: `fd08165e979a8ffaa030c56a4bd4853d805bf095`
- task set: `tasks/v2.jsonl`
- task-set SHA-256:
  `67ce3685c911781f91d9978696eb4ec64192aa03da5df8fb320f8680b6e411ba`
- API base URL: `https://qveris.ai/api/v1`
- API revision: `unreported` (the legacy runner did not capture it)
- catalog revision: `unreported`
- discovery limit: `10`

Artifacts:

- [`2026-07-23-gpt-5.6-sol-v2.runs.jsonl`](2026-07-23-gpt-5.6-sol-v2.runs.jsonl)
- [`2026-07-23-gpt-5.6-sol-v2.summary.json`](2026-07-23-gpt-5.6-sol-v2.summary.json)

### Interpretation

The component metrics have different denominators. Call success is 44 of the 50
attempted calls; strict workflow success is 35 of all 54 trials and additionally
requires grounded selection and inspection, complete required parameters, and
all task constraints.

The four adapter-stage failures were retained: all three domain-intelligence
trials selected a catalog capability whose inspected contract exposed no usable
domain parameter, and the final earthquake trial reached the 120-second adapter
timeout during parameterization. The adapter intentionally records only a safe,
generic failure at this boundary, so no more specific model event can be
attributed to that original trial. Six well-formed calls returned
`success: false`: all three IP lookup trials and all three company-profile
trials.

Constraint misses include three valid `symbol=USD/EUR` executions that the
current v2 alias scorer does not split into separate base/quote constraints,
three URL-encoded news queries, and three timezone-list selections that executed
successfully but did not accept Tokyo as an input. These details are why the
strict workflow metric should not be interpreted as API availability alone.

All checked-in run files are sanitized public artifacts produced under
`public-artifact-v1`. They omit execution/search/connection identifiers and the
ordered discovery catalog. Raw operational records are not stored in this
repository.
