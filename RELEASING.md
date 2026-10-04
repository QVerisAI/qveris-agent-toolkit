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
   Before tagging, complete the SDK candidate checks described below on the
   merged commit and record its SHA in the release acceptance report.
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

   The coordinator stops after all four publish workflows complete. Benchmark
   acceptance is a separate maintainer-run operation and is never dispatched
   from GitHub Actions. `--no-watch` registers the publish workflows and leaves
   monitoring to the operator.

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

## SDK candidate validation

SDK pull requests and manual publish-workflow runs build and verify distributions
without publishing. To validate the merged candidate, run:

```bash
gh workflow run contract-tests.yml --ref main
gh workflow run js-sdk-publish.yml --ref main
gh workflow run python-sdk-publish.yml --ref main
```

Check the actual head SHA of every run; if `main` advances, rerun against the
candidate branch and confirm all evidence refers to the same commit. Manual
dispatch, including a dispatch targeting a tag, cannot publish.

The JS workflow installs the packed core SDK outside the checkout, without
optional AI/Zod peers, compiles a consumer against its public declarations and
checks Detail/Query fixtures, single-submit failures and recovery actions.
The separate contract workflow tests the six packed AI/Zod combinations.
The Python workflow builds wheel and sdist before tagging and installs each in
a separate clean environment on Python 3.8–3.12 and Windows 3.11. It verifies
public exports, generated models, bundled changelog, dependency consistency,
example syntax and the same mocked paid-operation safety paths. Repository
tests remain frozen; clean consumer installs deliberately resolve the declared
runtime dependencies without the repository's development environment.

For local installation checks after installing JS development dependencies:

```bash
npm run verify:release:js -- --output /tmp/qveris-release-js
uv build --no-sources --directory packages/python-sdk --out-dir /tmp/qveris-release-python
python scripts/verify-python-release.py --dist /tmp/qveris-release-python --output /tmp/qveris-release-reports
```

These commands install dependencies in temporary directories and use mock
transports for service calls. They do not make paid service requests. JSON
reports record the commit SHA, runtime, checks and distribution SHA-256;
`live_service: not_run` explicitly separates installation checks from live
acceptance. CI keeps distributions and reports for seven days. Copy
[`maintenance/RELEASE_REPORT_TEMPLATE.md`](maintenance/RELEASE_REPORT_TEMPLATE.md)
and complete the maintainer-run live checks with bounded credentials before
release acceptance. Review skipped framework tests individually.

Tag workflows repeat validation. The JS publish job checks the verified archive's
commit, version and checksum, then publishes that archive without rebuilding or
running package scripts. Python publishing waits for all wheel/sdist installation
checks and uploads the same immutable workflow distributions. Publishing jobs
alone receive registry credentials or identity-token permissions.

## Discover-call release cadence

Run release benchmark acceptance on a maintainer-controlled machine, never in
GitHub Actions. Use a clean checkout of the exact commit shared by the four
release tags, a bounded QVeris credential, and the model CLI's local login.
Do not upload either credential or raw records to GitHub.

1. Review `benchmarks/discover-call/cadence.json`. It pins the immutable task
   version, trials, discovery limit, model identity, adapter paths, reasoning
   effort, and exact CLI version. Configuration changes require methodology
   review before sampling.
2. Verify every coordinated tag points to the checkout commit and install the
   exact configured model CLI in an isolated temporary prefix. Confirm its
   version and local authentication before any QVeris calls. From the repository
   root, print the validated plan and its exact provenance values:

   ```bash
   RELEASE_SHA="$(git rev-parse HEAD)"
   node scripts/benchmark-release-cadence.mjs plan --release-sha "$RELEASE_SHA"
   ```

3. Run the reference lane and configured-model lane sequentially from
   `benchmarks/discover-call`. Pass `release_sha` as `--toolkit-revision`, but
   use the plan's decorated `reference_adapter_revision` and
   `configured_adapter_revision` values for `--adapter-revision`; a bare commit
   SHA is invalid. With the current cadence these are
   `<release_sha>/reference-v1` and
   `<release_sha>/codex-cli-0.144.1/medium`. Write raw checkpoint files outside
   the repository.
4. Do not selectively retry failed trials. An interrupted or incomplete batch
   is diagnostic only and cannot be published as the release baseline.
5. Generate paired public artifacts with `src/publish.mjs`, then run `npm test`
   and `npm run validate`. Confirm 54 records per lane under the current config
   and scan every public artifact for protected identifiers and raw values.
6. Generate the result section with
   `scripts/benchmark-release-cadence.mjs document`, insert it into the latest
   result index, and publish only through a normal reviewed PR. Review failure
   classes, API/catalog comparability, and model-revision wording before merge.

The current 18-task, three-trial, two-lane configuration permits at most 108
QVeris Call attempts. Discover/Inspect traffic and model requests are
additional. A provider revision of `unreported` remains a configured-model
sample rather than a pinned-model claim.

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
