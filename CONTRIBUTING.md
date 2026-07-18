# Contributing

Thanks for your interest in the QVeris Agent Toolkit! This monorepo hosts five independently released packages plus agent-facing assets.

## Layout

| Path | What | Stack / tests |
|------|------|---------------|
| `packages/cli` | `@qverisai/cli` | Node ≥18, `node --test` |
| `packages/mcp` | `@qverisai/mcp` MCP server (stdio + streamable HTTP) | TS strict, vitest |
| `packages/js-sdk` | `@qverisai/sdk` typed REST client + Vercel AI adapter | TS strict, vitest |
| `packages/python-sdk` | `qveris` on PyPI (client, Agent runtime, framework adapters) | Python ≥3.8, uv + pytest |
| `packages/openclaw-qveris-plugin` | OpenClaw plugin | Node ≥22.19, TS, vitest |
| `skills/`, `recipes/`, `agent/`, `ecosystem/` | Agent-facing docs, recipes, manifests | see `ecosystem/CONTRIBUTING.md` for manifest contributions |

## Dev setup & running tests

From the repo root, the `package.json` task runner fans out across every package
(it delegates to each package's own scripts; there are no root dependencies or
workspaces). Running the full toolkit requires Node `>=22.22.3` because it includes
the OpenClaw development toolchain; development uses that version from `.nvmrc`. The CLI, MCP,
and JavaScript SDK retain their package-level Node 18 support. The Python SDK uses `uv`.

```bash
npm run install:all   # install all package deps (npm ci + uv sync)
npm run lint          # lint every package (eslint/prettier + ruff)
npm run typecheck     # typecheck the TS packages
npm test              # run every package's test suite
npm run build         # build the TS packages
```

Or work in a single package (each is self-contained):

```bash
# TS/JS packages (mcp, js-sdk, openclaw-qveris-plugin)
cd packages/mcp && npm ci && npm run typecheck && npm test

# CLI (no install needed)
cd packages/cli && node --test

# Python SDK (uses uv)
cd packages/python-sdk && uv run --extra dev pytest
```

Contract alignment: the public OpenAPI spec lives at `docs/openapi/`; generated types and drift guards are enforced in CI (`contract-tests.yml`). If you change API-shaped types, regenerate via `scripts/regenerate-openapi-artifacts.sh` — never hand-edit `generated/` files.

## Pull requests

- Keep PRs scoped to one package/concern where possible; reference the issue (`#123`).
- Add or update tests for behavior changes; all suites run on ubuntu **and** windows in CI.
- Update the affected package's `CHANGELOG.md` `[Unreleased]` section (Keep a Changelog format) — releases fail without it.
- New API-visible fields should follow additive compatibility (see each package's README compatibility notes).

## Releases

Maintainers only — see [RELEASING.md](RELEASING.md). Versions are tag-driven per package; publish workflows enforce version↔tag and CHANGELOG gates.

## Security

Never open a public issue for a vulnerability — see [SECURITY.md](SECURITY.md).
