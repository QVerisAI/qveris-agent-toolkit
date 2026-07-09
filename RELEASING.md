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
4. **Tag the release commit with an annotated tag**, using the new CHANGELOG section as the tag message — this is what powers the release Highlights (#101), so the changelog and the tag stay one source of truth:

   ```bash
   # Example for the MCP server
   git tag -a mcp-v0.8.0 -F <(sed -n '/^## \[0.8.0\]/,/^## \[/p' packages/mcp/CHANGELOG.md | sed '$d' | tail -n +2)
   git push origin mcp-v0.8.0
   ```

5. The publish workflow verifies **version == tag** and **CHANGELOG has the section**, runs the full test matrix (ubuntu + windows), publishes, and creates the GitHub Release.

## Notes

- `CHANGELOG.md` ships inside each package (npm `files` whitelist / Python sdist), so registry users can read version diffs offline.
- The cli/mcp/js-sdk/python-sdk publish workflows also support `workflow_dispatch` to run the test matrix on demand; a dispatch never publishes (publishing requires an actual tag push).
- Keep the `[Unreleased]` section current as PRs land — release day should only be a rename, not an archaeology dig.
