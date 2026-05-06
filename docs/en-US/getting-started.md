# QVeris Documentation

## What is QVeris

**QVeris** is the **capability routing network for agents**. It lets your agent:

- **Discover** capabilities (APIs, data sources, automations) using natural language — free
- **Inspect** candidate capabilities to compare parameters, success rate, latency, and price
- **Call** any capability with structured parameters and get structured results back

QVeris works well in agent loops (Discover → Inspect → Call → feed results back to the model) and supports multiple integration styles.

**Cost:** Discover is free. Call is priced by each capability's billing rule, with final settlement visible in usage history and the credits ledger. Free tier includes 1,000 credits. Details at [qveris.ai/pricing](https://qveris.ai/pricing).

---

## Quick start

There are several ways to use QVeris. Pick the one that fits your workflow.

### Use the QVeris CLI

Discover, inspect, and call capabilities directly from your terminal.

**Install**

```bash
curl -fsSL https://qveris.ai/cli/install | bash
```

Also available via npm (`npm install -g @qverisai/cli`) or without installing (`npx @qverisai/cli`).

**Quick start**

```bash
qveris login                              # Authenticate
qveris discover "weather forecast"        # Find capabilities
qveris inspect 1                          # View details
qveris call 1 --params '{"wfo":"LWX","x":90,"y":90}'  # Execute
```

The CLI also supports interactive mode (`qveris interactive`), code generation (`--codegen curl|python|js`), and shell completions. For the full reference, see [CLI documentation](cli.md).

---

### Use QVeris MCP anywhere MCP is supported

If your client supports **Model Context Protocol (MCP)**, you can add the official QVeris MCP server and immediately get:

- `discover` (Discover)
- `inspect` (Inspect)
- `call` (Call)

For the full MCP reference, see [MCP Server documentation](mcp-server.md).

**Configure (Cursor / any MCP client)**

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
- optionally call `inspect` to review the best candidate
- call `call` with the capability id + parameters

---

### Use the QVeris Python SDK

Get it from [github](https://github.com/QVerisAI/sdk-python) and install:

```bash
pip install qveris
```

Set environment variables:

- `QVERIS_API_KEY` (from [QVeris](https://qveris.ai))
- `OPENAI_API_KEY` (or your OpenAI-compatible provider key)
- `OPENAI_BASE_URL` (optional; for OpenAI-compatible providers)

Minimal streaming example:

```python
import asyncio
from qveris import Agent, Message

async def main():
    agent = Agent()
    messages = [Message(role="user", content="Discover a weather capability and check New York weather.")]
    async for event in agent.run(messages):
        if event.type == "content" and event.content:
            print(event.content, end="", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
```

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

If output exceeds `max_response_size`, the response includes `truncated_content` plus a temporary `full_content_file_url`.

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

If you are configuring an AI coding agent (Claude Code, Cursor, OpenCode, Trae, etc.), you can give the [Agent Setup Guide](https://github.com/QVerisAI/QVerisAI/blob/main/agent/SETUP.md) to your agent along with your API key. It will auto-detect the environment and configure both the MCP server and skill definition automatically.

Supported environments: Claude Code, OpenCode, Cursor, Trae, VS Code, and OpenClaw.

---

### How to get an API key

1. Go to [QVeris](https://qveris.ai)
2. Sign in / create an account (free, 1,000 credits on signup)
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
