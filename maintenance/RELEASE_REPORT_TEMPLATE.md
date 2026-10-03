# SDK release acceptance report

Copy this template for each candidate. An unchecked item is pending, not passed.
Attach credential-free evidence only; keep tokens, raw authenticated responses,
signed URLs and private account identifiers outside the repository and CI artifacts.

## Candidate identity

- Candidate commit SHA:
- Package names and versions:
- Public OpenAPI version:
- Workflow run URLs and their actual head SHAs:
- JS archive filename and SHA-256:
- Python wheel filename and SHA-256:
- Python sdist filename and SHA-256:
- Automated installation report artifact URLs:

## Automated gates

- [ ] Source tests, lint, type checks and examples pass on the candidate commit.
- [ ] Python lockfile check passes; repository tests use frozen dependencies.
- [ ] JS core runtime matrix: Node 18/20/22/24 on Linux and Node 22 on Windows.
- [ ] Python source and wheel/sdist installs: 3.8–3.12 on Linux and 3.11 on Windows.
- [ ] JS packed AI SDK 5/6/7 × Zod 3.25.76/4 compatibility passes.
- [ ] Python native framework tests pass; independent CrewAI job has zero skips.
- [ ] JS packed core works without optional AI/Zod peers, and consumer types compile.
- [ ] Both Python distributions install in separate clean environments, include
  generated models and changelog, and pass dependency consistency checks.
- [ ] Installed Detail/Query match the public fixtures.
- [ ] Paid Query submits once after HTTP 401/429/503/307/308, transport failures,
  timeout, malformed JSON and invalid success responses.
- [ ] Uncertain outcomes expose a non-automatic next action and retain execution
  identity when available.
- [ ] Optional Probe defaults, parameter validation and host identity tests pass.
- [ ] Delegation expiry, capacity, coalescing and clear-cache race regressions pass.
- [ ] Generated docs, public copy boundaries and secret scanners pass.
- [ ] Versions, changelog entries, public version references and tags agree.

Record permitted skips with runtime/framework and reason. Do not count a missing
framework dependency as a successful native integration test. Installation reports
cover mock transports; `live_service: not_run` does not satisfy live acceptance.

## Maintainer-run live acceptance

Run from a clean environment installed from these exact distributions. Configure
a bounded test credential locally; never pass it as a command-line argument or
upload it. Inspect the current public contract before choosing parameters.

- [ ] Capability Detail succeeds against the supported public service.
- [ ] Probe validates parameters and returns current schema/quote without executing
  the capability; a quote is not a reserved price.
- [ ] At most one deliberate paid Query per SDK is submitted with an explicit,
  approved spending ceiling. Record the total test budget before starting.
- [ ] Execution identity, result shape and final usage/ledger records agree.
- [ ] An unknown Query outcome is reconciled or reviewed before another submission.
- [ ] If accepting Delegation service behavior: use a registered confidential test
  client to verify exchange, narrowing, expiry, wrong audience and revoke/introspection.

Budget and approval reference:
Service/contract checked and UTC timestamp:
Credential-free evidence references:
Pending external prerequisites and their impact on the release:

## Release decision

- [ ] All required gates pass on this exact candidate; required live checks have evidence.
- [ ] Published claims and migration notes match tested compatibility.
- [ ] Final distributions match the recorded checksums; no rebuild after acceptance.

Decision and reviewer:
Any candidate change invalidates prior acceptance for the changed behavior and
requires refreshed reports. Push release tags only after the release decision.
