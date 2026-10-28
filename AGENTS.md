# QVeris Agent Toolkit

Instructions for coding agents working in this repository. Start with the section relevant to the task; configuring an integration or calling a provider is not a prerequisite for editing or testing the toolkit.

## Sources of truth

- [CONTRIBUTING.md](CONTRIBUTING.md): development and contribution workflow.
- [agent/SETUP.md](agent/SETUP.md): installing and configuring an integration without exposing credentials.
- [agent/GUIDELINES.md](agent/GUIDELINES.md): capability selection, parameters, billing, and recovery.
- [skills/qveris/SKILL.md](skills/qveris/SKILL.md): MCP workflow; [skills/qveris-cli/SKILL.md](skills/qveris-cli/SKILL.md): CLI workflow.
- [docs/openapi/qveris-public-api.openapi.json](docs/openapi/qveris-public-api.openapi.json): checked-in public API contract. Use the intended deployment's current OpenAPI and operation documentation when checking live service support.
- [Official documentation](https://qveris.ai/docs) and [machine-readable index](https://qveris.ai/llms.txt): service entry points. Package manifests, release tags, and package guides determine client versions and supported client behavior; a website mirror can lag a release.

Do not copy catalog counts, client versions, trial amounts, expiry periods, or prices into instructions as permanent guarantees. Check the relevant manifest, response, or current deployment documentation.

## Working in the repository

The root package is a task runner, with no npm workspaces or root dependencies. Packages install and release independently.

| Path | Purpose | Checks |
| --- | --- | --- |
| `packages/cli` | `@qverisai/cli`, shell integration | Node test runner, ESLint/Prettier |
| `packages/mcp` | `@qverisai/mcp`, local stdio and HTTP server | TypeScript, Vitest |
| `packages/js-sdk` | `@qverisai/sdk`, REST client and AI adapter | TypeScript, Vitest |
| `packages/python-sdk` | `qveris`, Python client and agent integrations | uv, pytest, Ruff |
| `packages/openclaw-qveris-plugin` | OpenClaw plugin | TypeScript, Vitest |
| `agent/`, `skills/`, `recipes/`, `plugins/`, `ecosystem/` | Instructions, examples, integration assets | Script and contract checks |
| `docs/`, `contracts/` | Localized guides and public contracts | Locale, API, and compatibility checks |

Use Node from `.nvmrc` (`22.22.3`) for the full development toolchain and `uv` for Python. Package runtime compatibility is defined by each package's manifest; do not raise it merely to match the root development runtime.

Full setup and validation, from the repository root:

```bash
npm run install:all
npm run lint
npm run typecheck
npm test
npm run build
```

For a scoped change, start with the affected checks:

```bash
# CLI: no dependency installation needed for its Node tests
npm --prefix packages/cli test

# Example TypeScript package
npm --prefix packages/mcp ci
npm --prefix packages/mcp run typecheck
npm --prefix packages/mcp test

# Python
cd packages/python-sdk
uv sync --frozen --extra dev
uv run --frozen --extra dev pytest -q
```

Documentation and contract checks, from the repository root:

```bash
npm run check:public-copy
node scripts/check-doc-locales.mjs
npm run test:scripts
```

- Keep changes scoped. Add or update tests for changed behavior and run checks appropriate to the affected packages. Preserve portability; CI includes Ubuntu and Windows coverage.
- Keep public fields additive and preserve documented compatibility. Never hand-edit generated API artifacts. After changing API-shaped contracts, use `scripts/regenerate-openapi-artifacts.sh` and inspect the resulting diff.
- Add an `[Unreleased]` entry to the affected package's `CHANGELOG.md` for package changes. Repository instruction edits alone do not require package version or changelog changes.
- Update corresponding guides in `docs/en-US`, `docs/zh-CN`, and `docs/cn/zh-CN` when changing shared behavior. Preserve deployment-specific links and endpoint instructions. Use the existing docs synchronization workflow rather than independently editing a website mirror.
- Releases and publishing are maintainer operations: follow [RELEASING.md](RELEASING.md). Report vulnerabilities through [SECURITY.md](SECURITY.md), never a public issue.
- GitHub branch names, commit messages, PRs, issues, and comments must not include `OpenAI` or `Codex` unless the code or issue itself is directly about them.

## Using QVeris during a task

QVeris discovers professional data services and tools. Discover finds capabilities, not answers. Use it when a suitable capability is missing, the provider is unknown, provider comparison or fallback is needed, or the user requests QVeris. Choose among available tools by task fit, freshness, provenance, cost, and call overhead. Local code changes and text transformations do not need a remote Call; ordinary documentation browsing can use a browser.

### Access and deployment

- Reuse an appropriate configured connection. For a remote-capable client, use the Hosted MCP endpoint from the intended deployment's guide and browser OAuth where supported. For shell use, `qveris auth login` starts device authorization; the user completes browser sign-in. Local stdio MCP is the fallback described in [agent/SETUP.md](agent/SETUP.md).
- Endpoint selection is explicit. Set `QVERIS_BASE_URL` to the intended deployment's complete API root before authenticating or issuing requests when an override is required. A key never selects an endpoint. Keep OAuth, API keys, discovery context, and execution recovery on the same intended deployment.
- Existing keys must be configured privately through a secret store, local environment, or the user's masked `qveris login` input. Do not ask for keys, claim codes, OTPs, or tokens in chat, read secret values into output, or put them in source control, command arguments, shared config, or logs.
- Preparing local MCP configuration does not require a key: `qveris mcp configure --target cursor --write` writes placeholders. The user completes the secret privately, then runs `qveris mcp validate --target cursor`. Do not use `--include-key` as a credential-free preparation step.

### Safe first check

For an authenticated CLI connection, start with discovery only:

```bash
qveris discover "weather forecast API" --limit 3 --json
```

The published CLI also supports explicit public read-only Discover and Inspect. Use a separate credential-free environment and profile:

```bash
qveris discover "weather forecast API" --public-read-only --limit 3 --json
qveris inspect 1 --public-read-only --json
```

Public access creates no account, key, credits, or execution authority. Do not combine it with credentials or cookies; an invalid key never falls back to public access. Public contexts cannot authorize Call. When upgrading, use an authenticated client, refresh the selected capability with Inspect, and omit the old public `search_id`; a fresh natural-language Discover is not required merely to change authentication.

Anonymous registration is a separate, explicit Agent API operation, not a diagnostic fallback. Do not register a trial during setup checks or discovery, or create another identity to evade a limit. If a task calls for a trial, follow the intended deployment's authentication and trial lifecycle documentation, store one-time secrets privately, and use the returned limits and expiry. Browser and Agent API claim flows have distinct contracts: follow the current receipt and refresh identity/permissions; do not promise that an old trial key survives claim.

### Selection, execution, and recovery

1. Discover with an English capability description such as `stock quote API`; put the user's entities and business values in parameters, not a factual question in the discovery query.
2. Default to Discover → Call when the result supplies a complete, current contract. Inspect when contract detail is missing/stale or needed to select a candidate. For provider comparison, Inspect each candidate whose current scope must be confirmed.
3. Probe when parameter validation, a current quote for a budget decision, or explicit preflight is needed. Probe is not execution, a price reservation, an enforceable spending cap, or user authorization. Never describe `max_credits` or a quote as a hard provider-currency limit without an explicit server contract. Obtain a quote for each candidate when comparing current prices.
4. Build parameters from the current request. An explicit empty contract means no parameters; an omitted contract requires Inspect. Preserve required, enum, and alternative constraints. Do not invent tool IDs or `search_id`, copy sample business values, or reuse results for a request for current data. Reuse routes only as the active client explicitly supports.
5. A Call can spend credits or have external effects; act within the user's requested scope and cost approval. Normal tests and documentation examples should use fixtures/local mocks instead of live provider execution. An exact zero quote alone does not guarantee free execution; use a documented server-enforced contract such as `require_zero_quote_v1` only when explicitly advertised and supported by the client.
6. For an unknown Call outcome, preserve the original execution ID and idempotency key. Use `qveris execution lookup <key>` or the documented read-only execution lookup before considering another Call. A timeout, missing record, or newly generated idempotency key does not prove the original was not executed. Never automatically resubmit an uncertain paid Call; do not treat HTTP 409 as permission to change the key and retry.
7. Pricing rules and pre-settlement billing are not final charges. Use usage history for charge outcomes and the credits ledger for balance movements. Start with summaries or precise execution filters; export and read large results in chunks. Report partial/unknown execution or settlement honestly.

See the package guides and [agent/GUIDELINES.md](agent/GUIDELINES.md) for full command and protocol details. Prefer canonical `discover`, `inspect`, `probe`, and `call` names; legacy aliases are compatibility surfaces.
