# Releasing

Each package releases independently via an annotated git tag; the matching GitHub Actions workflow runs the test matrix and publishes to npm / PyPI.

| Package | Tag format | Workflow |
|---------|------------|----------|
| `@qverisai/cli` | `cli-v<version>` | `cli-publish.yml` |
| `@qverisai/mcp` | `mcp-v<version>` | `mcp-publish.yml` |
| `@qverisai/sdk` | `js-sdk-v<version>` | `js-sdk-publish.yml` |
| `qveris` (PyPI) | `python-sdk-v<version>` | `python-sdk-publish.yml` |
| OpenClaw plugin | `qveris-plugin-v<version>` | `qveris-plugin-publish.yml` |

## Process

1. **Bump the version** in the package's `package.json` / `pyproject.toml`.
2. **Update `CHANGELOG.md`** (Keep a Changelog format): move the `## [Unreleased]` notes into a new `## [<version>] - <YYYY-MM-DD>` section, and update the compare links at the bottom. The publish workflow **fails if `CHANGELOG.md` has no `## [<version>]` section** for the tagged version.
3. Open a PR with the bump + changelog; merge it.
4. For a coordinated CLI, MCP, JavaScript SDK, and Python SDK release, check the merged metadata and publish all four tags from an up-to-date, clean `main`:

   ```bash
   npm run release:clients:check
   npm run release:clients:publish
   ```

   The coordinator validates package versions, npm/Python lockfiles, MCP
   `server.json`, each versioned Changelog section, and that every configured
   publish workflow exists and listens for the matching tag prefix. It creates
   annotated tags from those sections, pushes exactly one tag at a time,
   confirms the matching Actions run is registered before pushing the next
   tag, and then waits for all four publish workflows. If a run is interrupted,
   rerun the command: tags already present at the release commit are verified
   and resumed instead of recreated. Use `-- --no-watch` only when another
   operator will monitor the registered runs.

   After all four workflows finish successfully, the coordinator dispatches
   `discover-call-cadence.yml` for the shared release commit. The
   workflow validates that all four annotated tags point to that commit, then
   waits for approval in the protected `benchmark-production` environment.
   Approval authorizes the fixed call budget recorded in
   `benchmarks/discover-call/cadence.json`; a rejected or timed-out approval
   performs no model or QVeris calls. `--no-watch` deliberately does not
   dispatch the cadence because the coordinator has not verified publication
   success; it prints the exact manual dispatch command instead.

   For an individual package release, **tag the release commit with an
   annotated tag**, using the new Changelog section as the tag message — this
   is what powers the release Highlights (#101), so the Changelog and the tag
   stay one source of truth:

   ```bash
   # Example for the MCP server (stops at the next heading or the link
   # definitions, so it also works for the oldest section in the file).
   # --cleanup=verbatim keeps the "### Added" headings — git's default cleanup
   # strips lines starting with '#' as comments.
   git tag -a --cleanup=verbatim mcp-v0.8.0 -F <(awk '/^## \[0.8.0\]/{p=1; next} /^## \[/ || /^\[/{p=0} p' packages/mcp/CHANGELOG.md)
   git push origin mcp-v0.8.0
   ```

   > **Never batch release tags in one push.** GitHub does not create push
   > events when more than three tags are pushed in a single `git push`, so a
   > combined push can trigger **zero** publish workflows. The coordinated
   > command above enforces one push event per tag.

5. The publish workflow verifies **version == tag** and **CHANGELOG has the section**, runs the full test matrix (ubuntu + windows), publishes, and creates the GitHub Release. Python releases also require a current `uv.lock`. MCP releases verify `server.json` uses the same version and publish its metadata to the official MCP Registry with GitHub OIDC.

## Discover-call release cadence

The coordinated release cadence runs the immutable reference and configured
model lanes from the exact release commit. Raw operational records stay only in
the ephemeral Actions runner. If both complete, the workflow applies
`public-artifact-v1`, validates the paired public artifacts, updates the result
index, and uploads a named Actions artifact. It never writes benchmark artifacts
directly to `main` or creates a result branch.

One-time repository setup:

1. Create a protected environment named `benchmark-production`.
2. Require an explicit reviewer before deployments to that environment.
3. Configure environment secrets:
   - `QVERIS_API_KEY`: benchmark-only QVeris key with an intentionally bounded
     credit balance.
   - `OPENAI_API_KEY`: least-privilege credential used only by the pinned Codex
     CLI adapter runtime.
3. Review `benchmarks/discover-call/cadence.json` before a release. It pins the
   immutable task version, trials, discovery limit, model identifiers, adapter
   paths, reasoning effort, and exact CLI version. Config changes require the
   same review as benchmark methodology changes.

The current 18-task, three-trial, two-lane configuration permits at most 108
tool calls. Discover/Inspect traffic and model requests are additional, but no
failed trial is selectively retried by the cadence. Failed jobs do not upload
raw records or a partial artifact. A rerun requires a fresh protected-environment
approval; use it only for a deliberate new sample, not as an automatic retry.

Successful artifacts are retained for 90 days. They contain the paired public
records and a standalone result section, rather than a complete result index.
Review that section, all public records, failure classes, catalog/API
comparability, and model-revision wording before inserting it into the latest
result index in a normal reviewable PR.

For a material individual-package release that also needs a new quality
baseline, dispatch the same protected workflow after its publish job succeeds,
using the commit shared by the current coordinated tags:

```bash
gh workflow run discover-call-cadence.yml \
  --ref main \
  --field release_sha="$(git rev-parse HEAD)"
```

## Python: PyPI Trusted Publisher

The Python publish job authenticates to PyPI with GitHub OIDC. It must not receive a username, password, or long-lived API token.

### One-time configuration

1. In the GitHub repository, create an environment named `pypi` and restrict deployments to tags matching `python-sdk-v*`.
2. On the existing PyPI `qveris` project, open **Manage → Publishing**, add a GitHub Actions publisher, and enter these values exactly:

   | Field | Value |
   |-------|-------|
   | Owner | `QVerisAI` |
   | Repository | `qveris-agent-toolkit` |
   | Workflow | `python-sdk-publish.yml` |
   | Environment | `pypi` |

3. Confirm the workflow's `publish` job declares `environment: pypi`, grants `id-token: write` at job scope, and omits `username` and `password` from `pypa/gh-action-pypi-publish`. Release distributions must be built in the separate, unprivileged `build` job and transferred through a short-lived workflow artifact.

The environment name is part of the OIDC identity. A mismatch between GitHub and PyPI causes an `invalid-publisher` exchange failure.

### Release verification and token retirement

1. Publish a controlled patch release through the normal annotated `python-sdk-v<version>` tag flow.
2. Confirm the publish job exchanged a Trusted Publisher identity without reading `PYPI_API_TOKEN`.
3. On the PyPI release page, verify both the wheel and source distribution show publish attestations tied to `QVerisAI/qveris-agent-toolkit` and `python-sdk-publish.yml`.
4. Confirm the PyPI version, GitHub tag, and GitHub Release agree.
5. Only after those checks pass, revoke the old PyPI project token and delete the `PYPI_API_TOKEN` GitHub Actions secret.

### Recovery

- For `invalid-publisher`, compare the PyPI owner, repository, workflow filename, and environment with the workflow values above; do not weaken the environment or add a token first.
- If PyPI or GitHub OIDC has an incident and an urgent release cannot wait, create a temporary project-scoped PyPI token, restore the action's `password` input in a reviewed hotfix, and revoke both the token and hotfix immediately after the release. Never use an account-wide token.

## Notes

- `CHANGELOG.md` ships inside each package (npm `files` whitelist; Python sdist and wheel, plus a PyPI `Changelog` project link), so registry users can read version diffs offline.
- The cli/mcp/js-sdk/python-sdk publish workflows also support `workflow_dispatch` to run the test matrix on demand; a dispatch never publishes (publishing requires an actual tag push).
- Keep the `[Unreleased]` section current as PRs land — release day should only be a rename, not an archaeology dig.
