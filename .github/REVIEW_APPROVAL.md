# Review approval administration

Automatic code review and GitHub approval are separate integrations. The review
service produces receipts; this repository's `Review auto approval` workflow
submits an `APPROVE` through an independent GitHub App after validating a clean
receipt for the current PR head.

## Configuration

- Install the organization's dedicated review App on `QVerisAI/qveris-agent-toolkit`.
- Set Actions variable `REVIEW_APP_ID` to its App ID.
- Set Actions secret `REVIEW_APP_PRIVATE_KEY` from the App's existing secure key
  storage. Never put private keys in PRs, comments, logs, or ordinary variables.
- The App needs Pull requests write permission. The workflow requests a token
  scoped to this repository with only Pull requests write permission, then revokes
  it at the end of the job. It uses the default token only for read operations.
- A private App owned by another organization cannot be installed here. Use an
  organization-owned review App, or obtain explicit authorization to make the
  existing App installable outside its owner before installing it here.

Missing configuration fails explicitly. There is no personal-token fallback,
default-token approval permission expansion, or branch-protection bypass.

## Rules and recovery

Only receipts from the known review service's numeric bot and App identities are
trusted. The receipt must name the current head, report a clean review, and be
newer than suggestions reviews on that head. Incomplete review state, unresolved
automated findings, and active change requests prevent approval. Only approvals
owned by the configured review App are withdrawn when the facts change.

The privileged workflow checks out logic from the default branch and never runs
code from the PR branch. Changes to the approval policy therefore take effect
after merge, following an independent review.

After configuration changes or missed notifications, reconcile an existing PR:

```bash
gh workflow run review-auto-approve.yml --repo QVerisAI/qveris-agent-toolkit --ref main -f pull_number=437
gh workflow run review-auto-approve.yml --repo QVerisAI/qveris-agent-toolkit --ref main -f pull_number=440
```

Inspect the workflow job summary and the PR's review list. Success means an
`APPROVED` review by the configured App on the current head, rather than merely a
clean review comment. Repeating reconciliation on the same head is idempotent.

Run policy regression tests without network calls or credentials:

```bash
node --test scripts/auto-approve-review.test.mjs
```
