# QVeris Documentation

## Your first result: no account or key

In a credential-free terminal/profile, install the CLI and run one read-only discovery. No model-provider key, trial account or paid Call is needed. If you already have credentials, use the authenticated path below; public mode rejects supplied credentials rather than dropping them.

```bash
npm install -g @qverisai/cli
qveris discover "weather" --public-read-only --limit 1 --json --base-url https://qveris.ai/api/v1
```

Public read-only discovery searches published catalog keywords. Start with a short keyword such as `weather`; an empty result means no matching published candidate, not an authentication failure.

Humans should [get started](/playground) or [connect their AI](/plugins). Agents can read the [trial instructions](/try); only with explicit trial permission, use published CLI 0.13.0+ and `qveris auth trial --bounded` on a supporting endpoint. Actual terms, secure storage, bounded quote admission and human claim handoff are in the [CLI guide](/docs/cli). Discovery never creates a trial automatically.

## What is QVeris

**QVeris** is a **professional data and tool access platform**. It helps your agent:

- **Discover** capabilities (APIs, data sources, automations) using natural language — free
- **Inspect** candidate capabilities to compare parameters, success rate, latency, and price
- **Call** any capability with structured parameters and get structured results back

QVeris supports multiple integration styles. The default path is Discover → Call; add Inspect only when selection or request construction needs more current contract detail, and add Probe only when preflight validation or a current quote is needed.

For provider comparison, Inspect every candidate when current scope or a complete contract must be confirmed; a Discover summary is not confirmation. Probe every candidate when the comparison requires a current quote. Reuse may preserve an exact route, never business parameters or results: build parameters from the current request, and make a fresh Call for current, latest, today, or other time-sensitive data.

**Cost:** Discover is free. Call is priced by each capability's billing rule, with final settlement visible in usage history and the credits ledger. Free tier includes 1,000 one-time trial credits after signup verification. See [Pricing](/pricing) for details.

---

## Choose how to authenticate

- **Browser trial:** choose **Try in browser** in a tool page’s workbench; when the page displays trial controls, start explicitly and review the tool, inputs and quote before confirming one Call. No API key is returned to the browser. The [authentication and trial guide](/auth.md) explains recovery and claim.

- **OAuth:** use `qveris auth login`, or add the Hosted MCP endpoint in a client that supports OAuth discovery. Complete browser authorization without copying an API key.
- **Existing API key:** keep using it. Set `QVERIS_API_KEY` privately for REST/SDK/CLI, or use `qveris login` for masked key entry. This command requires a key; it is different from `qveris auth login`.
- **Public read-only REST:** explicitly use `X-Qveris-Access-Mode: public-readonly` in a separate uncredentialed REST client for Discover/Inspect only. It creates no trial or credits and cannot authorize Call. Do not combine it with Authorization or cookies; browser HTTP uses `credentials: "omit"`. A bad key never falls back to public access. See the [REST guide](/docs/rest-api) for limits, 401/429 guidance and authenticated upgrade. For explicit public clients, use the supported releases in the CLI/SDK guides below.
- **Agent without credentials:** explicitly register an anonymous trial using the existing Agent API. Registration issues credentials; it is not unauthenticated Discover or Call. See [Authentication and trial lifecycle](/auth.md) for one-time secrets, limits, expiry, and current claim restrictions.

Discover is free; the default CLI/SDK and authenticated MCP paths still require authentication. Never paste keys or claim codes into prompts, URLs, shared configuration, logs, or source control.

## Access modes and authentication upgrade

| Client or entry | Public read-only access | To continue with Call |
| --- | --- | --- |
| REST | Explicit public-readonly header; Discover/Inspect only, without credentials or cookies. | Authenticate; refresh the selected tool with Inspect, permissions and any necessary quote. |
| Hosted MCP | Separate read-only endpoint from the [MCP guide](/docs/mcp-server); only discover/inspect, no session. | Use the default OAuth or valid-key connection explicitly. |
| Local MCP 0.15.0 | Listing tool schemas without a key is not a successful Discover/Inspect request. | Configure a valid key as described in the [MCP guide](/docs/mcp-server). |
| CLI 0.13.0 | Explicit `--public-read-only` Discover/Inspect in a separate credential-free profile; see the [CLI guide](/docs/cli). | Deliberately use OAuth or an API key, then refresh the selected tool with authenticated Inspect. |
| Published QVeris SDKs: TypeScript 0.10.0 / Python 0.9.0 | Separate `Qveris.publicReadOnly()` or `PublicDiscoveryClient`; see the [TypeScript guide](/docs/js-sdk) and [Python guide](/docs/python-sdk). | Construct a new authenticated client and refresh Inspect without the old public context. |

A supplied invalid key never falls back to public access. Do not combine a public connection with credentials/cookies. On 401, authenticate for the intended operation; on 429, follow Retry-After and bounded retry guidance, without creating an identity or rotating credentials to evade limits. See the [REST guide](/docs/rest-api) for exact limits and errors.

Public access creates no account, key, trial credits or provider execution. Preserve the selected tool/input intent when upgrading, but omit the public search_id from authenticated Inspect. Use the fresh authenticated result and any necessary quote before explicit cost approval. An already selected tool does not require another natural-language Discover solely to upgrade authentication.

## Browser result, recovery and claim

A tool result may still be awaiting settlement. After a timeout or lost response, recover the original operation through the page; stopping the wait does not undo execution. Do not automatically replay a Call or create another trial. A quote is not a price lock, and any displayed tolerance is not extra granted credit.

When browser claim controls are available, verify a new account or continue with the receiving existing account, signing in if needed. Claim preserves the remaining original grant and its expiry, revokes old trial keys, and requires explicit formal identity continuation. Available formal-account credits automatically repay confirmed debt; insufficient credits leave the rest outstanding without blocking claim. Pending/unknown execution must first be reconciled. Read the receipt's repayment and remaining account debt, then refresh identity and permissions. Refresh an old discovery context with Discover; for an already selected tool, recheck inputs, permissions and the quote. Reuse a valid formal-account session; sign in only if needed. The Agent API uses separate credentials and claim rules.

Open [Saved trials](/account?page=saved-trials) in Account for receipts and original execution/search history summaries, up to 10 records per page. Use the verified receiving account; trial cookies and local claim references are not required. Source history stays separate from the ordinary usage list. Original provider response bodies are not shown.

For an unknown Call outcome, preserve the original execution ID and idempotency key when available. Use [execution lookup](/docs/api-reference/reconcile-call) before considering another Call; a timeout or not-found lookup does not prove that execution did not occur.

## Quick start

There are several ways to use QVeris. Pick the one that fits your workflow.

### Use the QVeris CLI

Discover, inspect, and call capabilities directly from your terminal.

**Install**

```bash
npm install -g @qverisai/cli
qveris auth login
qveris discover "weather forecast API" --json
```

Also available via npm (`npm install -g @qverisai/cli`) or without installing (`npx @qverisai/cli`).

**First success: Discover only**

Use OAuth without copying a key. If QVERIS_API_KEY is already configured, skip OAuth login.

```bash
qveris auth login
qveris discover "weather forecast API" --json
```

The CLI also supports interactive mode (`qveris interactive`), code generation (`--codegen curl|python|js`), and shell completions. For the full reference, see [CLI documentation](cli.md).

If the installation page gives you a copied v1 service/task context, save that JSON without adding parameters or secrets, then use the CLI's canonical consumer:

```bash
qveris call --context @context.json --params @params.json
```

The template is only a public-ID selection hint. The CLI rejects sensitive or executable content, ignores ordinary future fields with structured warnings, and automatically refreshes expired availability/price/permission snapshots. It runs Inspect or Probe only when the fresh Discover result and execution policy require them; service-only context returns candidates without guessing a tool. See [Copied service/task context](cli.md#copied-servicetask-context) for the contract and recovery steps.

---

### Use QVeris MCP anywhere MCP is supported

If your client supports **Model Context Protocol (MCP)** and remote Streamable HTTP, use Hosted MCP first. It requires no local package or Node.js process and immediately provides:

- `discover` (Discover)
- `inspect` (Inspect)
- `call` (Call)

For the full MCP reference, see [MCP Server documentation](mcp-server.md) or the [Hosted MCP guide](/hosted-mcp).

#### Hosted MCP configuration (preferred)

For clients with OAuth discovery, add the URL below and complete browser authorization. If OAuth is unsupported, use the valid-key fallback in the [MCP guide](/docs/mcp-server).

```json
{
  "mcpServers": {
    "qveris": {
      "type": "http",
      "url": "https://mcp.qveris.ai/mcp"
    }
  }
}
```

#### Local stdio fallback (for clients without remote HTTP support)

```json
{
  "mcpServers": {
    "qveris": {
      "command": "npx",
      "args": ["-y", "@qverisai/mcp"],
      "env": {
        "QVERIS_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**Try it**

> "Discover a weather capability and get the current weather in Tokyo"

The assistant will:

- call `discover` to find matching capabilities (e.g. "weather")
- optionally call `inspect` to review a suitable candidate
- call `call` with the capability id + parameters

---

### Use the QVeris Python SDK

The Python SDK now lives in this monorepo at [`packages/python-sdk`](../../packages/python-sdk). Install the published package with:

```bash
pip install qveris
```

For the full guide (client, agent, typed models, integration patterns), see [Python SDK](python-sdk.md).

Use the separate public client for one Discover without credentials; keep existing credentials in their own profile.

```python
import asyncio
from qveris import PublicDiscoveryClient, QverisConfig
async def main():
    async with PublicDiscoveryClient(QverisConfig(base_url="https://qveris.ai/api/v1")) as client:
        print(await client.discover("weather", limit=1))
asyncio.run(main())
```

Optional execution, candidate comparison and parameter validation are covered by the [Cookbook recipes](/docs/cookbook). Inspect when the current contract is incomplete; Probe when a current quote is needed. Confirm real inputs, permissions and cost before Call. Model-driven examples belong to the [Python SDK guide](/docs/python-sdk) and require separate model-provider credentials only when you choose that integration.

---

### Use the QVeris TypeScript SDK

The TypeScript/JavaScript SDK lives in this monorepo at [`packages/js-sdk`](../../packages/js-sdk). Install the published package with:

```bash
npm install @qverisai/sdk
```

It is a zero-dependency typed client (native `fetch`, Node.js 18+). For the full guide (config, API reference, typed responses, error handling), see [TypeScript SDK](js-sdk.md).

Start with one Discover using only your QVeris credential:

```typescript
import { Qveris } from "@qverisai/sdk";

const qveris = Qveris.fromEnv({ baseUrl: "https://qveris.ai/api/v1" });
const discovered = await qveris.discover("weather forecast API", { limit: 5 });
console.log(discovered.search_id, discovered.results.map(tool => tool.tool_id));
```

For execution and candidate comparison, use the [Cookbook recipes](/docs/cookbook). Review current inputs, permissions and cost before Call.

---

### Directly call the QVeris REST API

**Base URL**

`https://qveris.ai/api/v1`

**Authentication**

Send your API key in the `Authorization` header:

```text
Authorization: Bearer YOUR_API_KEY
```

#### 1) Discover capabilities

`POST /search`

**cURL**

```bash
curl -sS -X POST "https://qveris.ai/api/v1/search" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"weather forecast API\",\"limit\":10}"
```

You'll get a `search_id` and a list of capabilities (each with `tool_id`, params schema, examples, etc.).

**Python**

```python
import os
import requests

API_KEY = os.environ["QVERIS_API_KEY"]

resp = requests.post(
    "https://qveris.ai/api/v1/search",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={"query": "weather forecast API", "limit": 10},
    timeout=30,
)
resp.raise_for_status()
data = resp.json()
print(data["search_id"])
print(data["results"][0]["tool_id"] if data.get("results") else None)
```

**TypeScript**

```typescript
const apiKey = process.env.QVERIS_API_KEY!;

const resp = await fetch("https://qveris.ai/api/v1/search", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: "weather forecast API", limit: 10 }),
});

if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
const data = await resp.json();
console.log(data.search_id);
console.log(data.results?.[0]?.tool_id);
```

#### 2) Inspect capabilities

`POST /tools/by-ids`

Before calling, you can inspect one or more capabilities to see full details (parameters, success rate, latency, etc.).

**cURL**

```bash
curl -sS -X POST "https://qveris.ai/api/v1/tools/by-ids" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"tool_ids\":[\"openweathermap.weather.execute.v1\"],\"search_id\":\"YOUR_SEARCH_ID\"}"
```

**Python**

```python
resp = requests.post(
    "https://qveris.ai/api/v1/tools/by-ids",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "tool_ids": ["openweathermap.weather.execute.v1"],
        "search_id": "YOUR_SEARCH_ID",
    },
    timeout=30,
)
resp.raise_for_status()
print(resp.json())
```

**TypeScript**

```typescript
const resp = await fetch("https://qveris.ai/api/v1/tools/by-ids", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    tool_ids: ["openweathermap.weather.execute.v1"],
    search_id: "YOUR_SEARCH_ID",
  }),
});

if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
const data = await resp.json();
console.log(data.results);
```

Returns the same schema as `/search` — full capability details including params, examples, and stats.

#### 3) Call a capability

`POST /tools/execute?tool_id={tool_id}`

**cURL** (call the capability returned by Discover)

```bash
curl -sS -X POST "https://qveris.ai/api/v1/tools/execute?tool_id=openweathermap.weather.execute.v1" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"search_id\":\"YOUR_SEARCH_ID\",\"parameters\":{\"city\":\"London\",\"units\":\"metric\"},\"max_response_size\":20480}"
```

With compatibility auto-delivery (no `respond_with`), output over `max_response_size` includes `truncated_content` plus a temporary `full_content_file_url`. Explicit `respond_with: "full"` instead requires complete inline `result.data` or fails with `response_too_large` at the platform hard limit.

**Python**

```python
import os
import requests

API_KEY = os.environ["QVERIS_API_KEY"]

tool_id = "openweathermap.weather.execute.v1"  # from Discover results
search_id = "YOUR_SEARCH_ID"  # from /search response

resp = requests.post(
    f"https://qveris.ai/api/v1/tools/execute?tool_id={tool_id}",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "search_id": search_id,
        "parameters": {"city": "London", "units": "metric"},
        "max_response_size": 20480,
    },
    timeout=60,
)
resp.raise_for_status()
print(resp.json())
```

**TypeScript**

```typescript
const apiKey = process.env.QVERIS_API_KEY!;

const toolId = "openweathermap.weather.execute.v1"; // from Discover results
const searchId = "YOUR_SEARCH_ID"; // from /search response

const resp = await fetch(
  `https://qveris.ai/api/v1/tools/execute?tool_id=${encodeURIComponent(toolId)}`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      search_id: searchId,
      parameters: { city: "London", units: "metric" },
      max_response_size: 20480,
    }),
  }
);

if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
const data = await resp.json();
console.log(data);
```

---

### Set up QVeris in your AI Agent

If you are configuring an AI coding agent or desktop agent (ChatGPT (Codex), Claude Code, Cursor, GitHub Copilot, Cline, Roo Code, Continue, Kiro, Junie, Augment, Zed, Google Antigravity, Qoder, CodeBuddy, WorkBuddy, OpenCode, TRAE, and others), you can give the [Agent Setup Guide](https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/agent/SETUP.md) to your agent without credentials. It will auto-detect the environment and configure the available MCP server and skill definition. Complete OAuth authorization in your browser when supported; otherwise configure `QVERIS_API_KEY` privately in the client’s secret store or local environment. Never paste API keys or claim codes into installation prompts or chat.

Supported MCP desktop clients include ChatGPT (Codex), Claude Desktop, Cursor, GitHub Copilot, Cherry Studio, Cline, Roo Code, Continue, Kiro, Junie, Augment, Zed, Google Antigravity, Qoder, CodeBuddy, WorkBuddy, OpenCode, TRAE, Windsurf, and VS Code.

---

### How to get an API key

1. Open [Dashboard / API Keys](/account?page=api-keys)
2. Sign in / create an account (free, 1,000 one-time trial credits after signup verification)
3. Create an API key
4. Use it as:
   - `QVERIS_API_KEY` env var (MCP / Python SDK), or
   - `Authorization: Bearer ...` header (REST API)

---

### Recommended system prompt

Use this (copy/paste) in your assistant's system prompt when enabling QVeris tools:

```text
You are a helpful assistant that can dynamically discover and call capabilities to help the user. First think about what kind of capabilities might be useful to accomplish the user's task. Then use the discover tool with a query describing the capability, not the specific parameters you will pass later. Then call suitable capabilities using the call tool, passing parameters through params_to_tool. If a capability has success_rate and avg_execution_time, consider them when selecting which to call. You can reference the examples given for each capability. You can make multiple tool calls in a single response.
```

---

### Open Ecosystem

QVeris's core engine is a managed service. All client-side tooling (MCP server, SDK, skills, plugins) is open source:

- **GitHub org**: [github.com/orgs/QVerisAI/repositories](https://github.com/orgs/QVerisAI/repositories)
- **ClawHub skills**: [clawhub.ai/skills?q=qveris](https://clawhub.ai/skills?sort=downloads&q=qveris)
- **npm packages**: [@qverisai](https://www.npmjs.com/org/qverisai)
- **Upstream contributions**: [openclaw/openclaw](https://github.com/openclaw/openclaw), [openclaw/clawhub](https://github.com/openclaw/clawhub)
