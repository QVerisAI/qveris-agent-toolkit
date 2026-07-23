# Published benchmark results

## 2026-07-23 — `gpt-5.6-sol`

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
| Workflow success, 95% Wilson interval | 51.48%–76.18% |

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
domain parameter, and one earthquake trial attempted prohibited tool use during
parameterization. Six well-formed calls returned `success: false`: all three IP
lookup trials and all three company-profile trials.

Constraint misses include three valid `symbol=USD/EUR` executions that the
current v2 alias scorer does not split into separate base/quote constraints,
three URL-encoded news queries, and three timezone-list selections that executed
successfully but did not accept Tokyo as an input. These details are why the
strict workflow metric should not be interpreted as API availability alone.
