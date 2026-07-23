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
   `server.json`, and each versioned Changelog section. It creates annotated
   tags from those sections, pushes exactly one tag at a time, confirms the
   matching Actions run is registered before pushing the next tag, and then
   waits for all four publish workflows. If a run is interrupted, rerun the
   command: tags already present at the release commit are verified and
   resumed instead of recreated. Use `-- --no-watch` only when another
   operator will monitor the registered runs.

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
