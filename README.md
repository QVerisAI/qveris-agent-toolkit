
<div align="center">
  <img src="assets/logo-light.png" width="120" alt="QVeris Logo" />

  <h1>QVeris Agent Toolkit</h1>

  <p><strong>Bring professional data to the AI you already use.</strong></p>
  <p>QVeris is a professional data and tool access platform for AI. This open-source toolkit provides the CLI, MCP server, Python SDK, skills, and REST API docs that help AI assistants, products, and workflows find services, review supported scope, call them, and audit usage.</p>
  <p>
  Website: <a href="https://qveris.ai" target="_blank"><b>https://qveris.ai</b></a>
  </p>

  <p>
    <b>🇺🇸 English</b> ·
    <a href="README_zh-CN.md">🇨🇳 简体中文</a>
  </p>

  <p>
    <a href="https://github.com/QVerisAI/qveris-agent-toolkit">
      <img src="https://img.shields.io/github/stars/QVerisAI/qveris-agent-toolkit?style=social" alt="GitHub stars" />
    </a>
    <a href="https://github.com/QVerisAI/qveris-agent-toolkit/actions/workflows/contract-tests.yml">
      <img src="https://github.com/QVerisAI/qveris-agent-toolkit/actions/workflows/contract-tests.yml/badge.svg?branch=main" alt="CI" />
    </a>
    <a href="https://www.npmjs.com/package/@qverisai/cli">
      <img src="https://img.shields.io/npm/v/@qverisai/cli?label=cli" alt="cli npm version" />
    </a>
    <a href="https://www.npmjs.com/package/@qverisai/mcp">
      <img src="https://img.shields.io/npm/v/@qverisai/mcp?label=mcp" alt="mcp npm version" />
    </a>
    <a href="https://www.npmjs.com/package/@qverisai/sdk">
      <img src="https://img.shields.io/npm/v/@qverisai/sdk?label=js-sdk" alt="js-sdk npm version" />
    </a>
    <a href="https://pypi.org/project/qveris/">
      <img src="https://img.shields.io/pypi/v/qveris?label=python-sdk" alt="PyPI version" />
    </a>
    <a href="https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/LICENSE">
      <img src="https://img.shields.io/github/license/QVerisAI/qveris-agent-toolkit" alt="license" />
    </a>
  </p>
</div>

---

- Professional data and tools across finance, search, weather, maps, documents, and more
- `Discover / Call` is the default path; `Inspect` and `Probe` are conditional checks for missing/stale contracts, comparison, parameter validation, or a current quote
- For provider comparison, Inspect every candidate when current scope or a complete contract must be confirmed; a Discover summary is not confirmation. Probe every candidate when the comparison requires a current quote. Reuse may preserve an exact route, never business parameters or results: build parameters from the current request, and make a fresh Call for current, latest, today, or other time-sensitive data.
- `Discover` is free. `Call` returns structured pre-settlement billing, with final charge outcomes available through usage audit and credits ledger views.
- **NEW** `QVeris CLI` — command-line access to professional data and tools for agents. [Learn more](#qveris-cli)
- Works with `CLI` / `MCP` / `Python SDK` / `REST API`

**When to use QVeris:** use it when built-in tools are insufficient, a provider must be found dynamically, comparison or fallback matters, or the user requests it. Keep using local or native tools when they already fit the task.

---

## Quick Start

### 🤖 I'm an Agent

> Your owner sent you here to learn about QVeris?
> → If you are an OpenClaw-style skill agent, use the official skill: [skills/openclaw/qveris-official/SKILL.md](skills/openclaw/qveris-official/SKILL.md)
> → If you are running in Cursor / Claude Code / OpenCode, follow the [Agent capability guide & install protocol](agent/SETUP.md)
> → Default path: Discover (free) → Call; use Inspect or Probe only when additional verification is needed

### 🧑‍💻 I have OpenClaw / Cursor / Claude Code installed

> Copy this to your Agent — done in 30 seconds:
> `Install QVeris skill following https://qveris.ai/skill/instruct.md and use QVERIS_API_KEY=your-key`
> → [Get API Key](https://qveris.ai/account?page=api-keys) (free, 1,000 one-time trial credits after signup verification)

### ⚙️ I'm a developer integrating via CLI / MCP / API / SDK

> → **[QVeris CLI](packages/cli)** — `npm install -g @qverisai/cli` or `curl -fsSL https://qveris.ai/cli/install | bash`
> → [MCP Server Doc](docs/en-US/mcp-server.md)
> → [REST API Doc](docs/en-US/rest-api.md)
> → [Python SDK](packages/python-sdk)

---

## For Agents

If you are an AI Agent evaluating whether to use QVeris, here is what you need to know.

**What QVeris gives you:**

- `Discover` — find candidate services with natural language (free)
- `Inspect` — optionally check missing or stale parameters, available signals, and billing details
- `Call` — invoke a selected service and receive structured results and pre-settlement billing when available
- `Usage audit` / `Credits ledger` — review request and credit outcomes through the interfaces that expose them
- **QVeris CLI** — access services via `qveris discover/inspect/call` without preloading the full service catalog
- Professional data and tools across finance, search, weather, maps, documents, social, blockchain, healthcare, and more
- Per-tool execution history, success-rate, and latency signals when supplied

**How to install:**

- **CLI (recommended)**: `curl -fsSL https://qveris.ai/cli/install | bash` — then use `qveris discover/inspect/call`
- See [SETUP.md](agent/SETUP.md) — supports OpenClaw / Claude Code / Cursor / OpenCode / Trae
- Install does not modify shell startup files by default (session-scoped)
- Must pass file checks + CLI verification to confirm success

**How to explain to your owner:**

> QVeris helps me find a service when the tools I already have are insufficient, review its supported scope when needed, and call it. Installation does not change system configuration unless explicitly requested. Call pricing and usage or credit records depend on the selected capability and supported interface.

**Billing and audit:**

- Discover: **free**
- Call: priced by structured `billing_rule`; call responses may include compact pre-settlement `billing`
- Final charge status: check `qveris usage` / `usage_history`
- Final balance movement: check `qveris ledger` / `credits_ledger`
- Free tier: 1,000 one-time trial credits after signup verification
- $19 = 10,000 credits (pay-as-you-go, credits never expire)
- Details: [qveris.ai/pricing](https://qveris.ai/pricing)

---

## 30-Second Setup

1. [Get API Key](https://qveris.ai/account?page=api-keys) (free, 1,000 one-time trial credits after signup verification)

### OpenClaw users

Send this to your Agent:

```
Install QVeris skill following https://qveris.ai/skill/instruct.md and use QVERIS_API_KEY=your-key
```

The Agent will download the [official OpenClaw skill](skills/openclaw/qveris-official/SKILL.md) and complete installation automatically.

### Cursor / Claude Code / OpenCode users

Follow the [setup guide (agent/SETUP.md)](agent/SETUP.md) — your Agent will configure MCP server + [skill](skills/qveris/SKILL.md) for your environment.

#### Cursor Marketplace plugin

The Cursor plugin in this repository bundles the hosted QVeris MCP connection and the official QVeris skills. After installing it from Cursor Marketplace:

1. Open the plugin configuration and enter your `QVERIS_API_KEY`.
2. Start a new agent session so Cursor can connect to `https://mcp.qveris.ai/mcp`.
3. Confirm that `discover`, `inspect`, `probe`, `call`, `usage_history`, and `credits_ledger` are available.

The API key is stored by Cursor as a plugin variable and is never committed to this repository.

#### Gemini CLI extension

Install QVeris directly from this repository:

```bash
gemini extensions install https://github.com/QVerisAI/qveris-agent-toolkit
```

During installation, enter your `QVERIS_API_KEY` when prompted. Gemini CLI stores it as a sensitive extension setting and connects to the hosted QVeris MCP server at `https://mcp.qveris.ai/mcp`.

Restart Gemini CLI after installation, then run `/mcp` to confirm that the `qveris` server is connected and its tools are available.

### After setup

Try a task: "Check the current weather in Tokyo"

**Safety:**

- Install does not modify your shell config (unless you explicitly ask)
- Capability calls are remote API requests and do not grant a called service access to your local filesystem or system configuration
- You can review usage and credit records through supported interfaces

---

## QVeris CLI

**Access professional data and tools from your agent's shell.**

CLI executes as a subprocess and finds services on demand, without preloading the full service catalog. Instructions, commands, and results still consume context tokens. QVeris MCP likewise exposes a compact tool surface instead of every service definition.

```bash
# Install (one-liner)
curl -fsSL https://qveris.ai/cli/install | bash

# Or via npm
npm install -g @qverisai/cli
```

```bash
# Guided first call: `init` handles selection and validation for you
$ qveris init

# Default agent workflow: discover → call
$ qveris discover "weather forecast API"
Found 5 capabilities matching your query
1. gridpoint_forecast  by Weather.gov
   params: wfo (string, required), x (number, required), y (number, required)

$ qveris call 1 --params '{"wfo":"LWX","x":90,"y":90}'
✓ success
{ "forecast": "Sunny, high near 75..." }

# Optional when selection or request construction needs missing details
$ qveris inspect 1

# Optional when parameters need validation or a budget decision needs a current quote
$ qveris probe 1 --params '{"wfo":"LWX","x":90,"y":90}' --checks schema,quote

$ qveris usage --mode search --execution-id <execution_id>
# Confirms charge_outcome and actual_amount_credits for that call
```

### Why CLI over MCP for agents?

| | CLI | MCP |
|---|---|---|
| **Token cost** | No upfront catalog schemas; command/result tokens still apply | Depends on client context handling and exposed routing schemas |
| **Startup** | Instant (`npx` or global install) | Requires server process + transport handshake |
| **Output** | Deterministic schema, `--json` for parsing | JSON over stdio, varies by client |
| **Scalability** | On-demand discovery, no catalog preloading | Routing schemas stay separate from catalog size |
| **Debugging** | Visible in terminal, `--dry-run` preview | Opaque, buried in MCP logs |
| **Auth** | Built-in endpoint; explicit override via `QVERIS_BASE_URL` | Same |

Usage and ledger commands default to aggregated summaries. Large audit exports are written to local JSONL files under `.qveris/exports/` instead of being printed into Agent context.

**When to use CLI**: Agent frameworks that support `exec` / `bash` tool (Claude Code, OpenClaw, Cursor terminal, etc.)
**When to use MCP**: IDE integrations that only support MCP protocol (Cursor inline, Claude Desktop)

Full CLI documentation: [packages/cli/README.md](packages/cli/README.md)

---

## Developer Integration

### Access methods

| Method | Use case | Docs |
|--------|----------|------|
| **CLI** (recommended) | Claude Code / OpenClaw / any agent with exec | [CLI docs](packages/cli/README.md) |
| MCP Server | Cursor / Claude Desktop / MCP-only clients | [MCP docs](docs/en-US/mcp-server.md) |
| Python SDK | Python projects, agent frameworks | [Python SDK docs](packages/python-sdk/README.md) |
| TypeScript SDK | Node.js / TypeScript projects | [JS SDK docs](packages/js-sdk/README.md) |
| REST API | Any language, custom integrations | [REST API docs](docs/en-US/rest-api.md) |

Stuck? See [Troubleshooting & FAQ](docs/troubleshooting.md).

### Service access workflow

Agents use three service-access actions, plus two read-only record paths:

| Action | API endpoint | Description |
|--------|-------------|-------------|
| **Discover** | `POST /search` | Find capabilities with natural language, returns candidates |
| **Inspect** | `POST /tools/by-ids` | View capability details, parameters, quality signals |
| **Call** | `POST /tools/execute` | Invoke a capability, get structured results, and optionally record model attribution |
| **Usage audit** | `GET /auth/usage/history/v2` | Check request status, charge outcome, and actual charge |
| **Credits ledger** | `GET /auth/credits/ledger` | Check final credit balance movements |

The reproducible [Discover → Call accuracy benchmark](docs/en-US/discover-call-benchmark.md)
measures grounded selection, parameterization, and real execution success per
model. Its task set, runner, raw-record format, and deterministic scorer are
public under [`benchmarks/discover-call`](benchmarks/discover-call/README.md).

### Professional data and tool access

- A service catalog across multiple professional-data and tool categories
- Parameter schemas, examples, success rate, and average latency are available when supplied for a service
- Supports `private` / `org` / `public` service visibility levels
- Browse available services: [qveris.ai/providers](https://qveris.ai/providers)

---

## Pricing

QVeris uses pay-as-you-go pricing. No subscriptions.

| Plan | Price | Credits | Notes |
|------|-------|---------|-------|
| Free | $0 | 1,000 trial credits | One-time grant after signup verification |
| Standard | $19 | 10,000 credits | Buy on demand, never expire |
| Scale | See pricing page | Based on selected package | Current packages and bonuses shown at checkout |

- **Discover is free** — Agents can explore all capabilities at zero cost
- **Call** is priced by structured billing rules, with final charges auditable through usage history and the credits ledger
- No monthly fees, no auto-renewal
- Details: [qveris.ai/pricing](https://qveris.ai/pricing)

---

## Security & Trust

- Capability calls are remote API requests and do not grant a called service access to your local filesystem or system configuration
- Session-scoped config, no system file modifications by default
- Usage and credit records through supported interfaces
- RBAC and per-capability access control
- Rate limiting and quota enforcement
- Enterprise options (VPC / private cloud) planned

---

## What's New

Latest capabilities and updates: [qveris.ai](https://qveris.ai)

---

## Open Ecosystem

QVeris provides managed service access alongside open-source client tooling. We actively support the ecosystem by open-sourcing the MCP server, SDKs, Agent skills, and plugins, and by contributing code upstream.

### Monorepo packages

This repository (`QVerisAI/qveris-agent-toolkit`) is the primary monorepo for QVeris client-side tooling:

| Package | Path | Distribution |
|---------|------|--------------|
| MCP Server | [`packages/mcp`](packages/mcp) | [@qverisai/mcp](https://www.npmjs.com/package/@qverisai/mcp) |
| CLI | [`packages/cli`](packages/cli) | [@qverisai/cli](https://www.npmjs.com/package/@qverisai/cli) |
| Python SDK | [`packages/python-sdk`](packages/python-sdk) | [qveris](https://pypi.org/project/qveris/) |
| TypeScript SDK | [`packages/js-sdk`](packages/js-sdk) | [@qverisai/sdk](https://www.npmjs.com/package/@qverisai/sdk) |
| Agent docs | [`agent/`](agent) | — |
| Skills | [`skills/`](skills) | — |

### Recipes and ecosystem manifests

Use [`recipes/`](recipes) for copy-paste workflow templates across finance research, risk/compliance, crypto monitoring, data analysis, and developer automation. The flagship recipes ship a runnable `run.sh`, and each package has runnable examples: [js-sdk](packages/js-sdk/examples), [MCP](packages/mcp/examples), [CLI](packages/cli/examples), and [Python SDK](packages/python-sdk/examples).

Use [`ecosystem/`](ecosystem) for the versioned QVeris manifest schema, marketplace-ready listing fields, permission declarations, contribution guide, and compatibility matrix.

### Other repositories

| Repository | Description |
|------------|-------------|
| [QVerisAI/open-qveris-skills](https://github.com/QVerisAI/open-qveris-skills) | Community skills (stock copilot, market reports, etc.) |
| [QVerisAI/openclaw-qveris-plugin](https://github.com/QVerisAI/openclaw-qveris-plugin) | OpenClaw plugin |
| [QVerisAI/vscode-qveris-ai](https://github.com/QVerisAI/vscode-qveris-ai) | VS Code extension |

Full list: [github.com/orgs/QVerisAI/repositories](https://github.com/orgs/QVerisAI/repositories)

### Distribution channels

- **npm**: [@qverisai](https://www.npmjs.com/org/qverisai) — MCP server, CLI
- **PyPI**: [qveris](https://pypi.org/project/qveris/) — Python SDK
- **ClawHub**: [clawhub.ai/skills?q=qveris](https://clawhub.ai/skills?sort=downloads&q=qveris) — OpenClaw skills
- **One-liner install**: `curl -fsSL https://qveris.ai/cli/install | bash`

### Upstream contributions

QVeris actively contributes to the broader Agent ecosystem:

- [openclaw/openclaw](https://github.com/openclaw/openclaw) — OpenClaw runtime
- [openclaw/clawhub](https://github.com/openclaw/clawhub) — ClawHub skill registry

---

## Community

- 🐦 **X (Twitter)**: [x.com/QVerisAI](https://x.com/QVerisAI)
- 💼 **LinkedIn**: [linkedin.com/company/qveris](https://www.linkedin.com/company/qveris)
- 📚 **Docs**: [qveris.ai/docs](https://qveris.ai/docs)
- 🧪 **Playground**: [qveris.ai/playground](https://qveris.ai/playground)

---

## ⭐ Star & Share

If you are building AI products or workflows that need professional data and tools, **star this repo** and share it with other builders.
