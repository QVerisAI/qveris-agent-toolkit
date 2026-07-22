# QVeris MCP Server Documentation

## What it is

`@qverisai/mcp` is the official QVeris MCP server for MCP-compatible clients such as Cursor, Claude Desktop, and other coding agents.

It gives agents access to QVeris through a small set of MCP tools:

- `discover` — Find capabilities by natural language
- `inspect` — Get detailed tool info (params, success rate, examples)
- `call` — Execute a tool with parameters
- `usage_history` — Context-safe usage audit summary/search/export
- `credits_ledger` — Context-safe final credit ledger summary/search/export

In other words, the MCP server is the agent-facing transport for the same core QVeris protocol described elsewhere in this repository.

---

## MCP vs REST API

Use the MCP server when:

- You are integrating QVeris into Cursor, Claude Desktop, OpenCode, or another MCP client
- You want the agent to call QVeris tools directly in chat
- You want the client to manage tool invocation automatically

Use the REST API when:

- You are writing application code or backend services
- You need direct HTTP control over requests and responses
- You are building SDK wrappers or production integrations

Both surfaces map to the same QVeris protocol:

| Protocol action | MCP tool | REST API |
|----------------|----------|----------|
| **Discover** | `discover` | `POST /search` |
| **Inspect** | `inspect` | `POST /tools/by-ids` |
| **Call** | `call` | `POST /tools/execute` |
| **Usage audit** | `usage_history` | `GET /auth/usage/history/v2` |
| **Credits ledger** | `credits_ledger` | `GET /auth/credits/ledger` |

> **Note:** The old tool names (`search_tools`, `get_tools_by_ids`, `execute_tool`) are still supported as deprecated aliases.

---

## Requirements

- Node.js `18+`
- A valid `QVERIS_API_KEY`
- An MCP-compatible client

---

## Quick Start

### Install via `npx`

```bash
npx -y @qverisai/mcp
```

The MCP server reads configuration from environment variables:

```bash
QVERIS_API_KEY=your-api-key          # Required
QVERIS_BASE_URL=https://qveris.ai/api/v1  # Optional: override API base URL
```

### Configure with QVeris CLI

Use the CLI to generate client config without hand-editing JSON. By default it prints a safe config with `YOUR_QVERIS_API_KEY` placeholders; placeholder output intentionally fails API key validation until you replace it or use `--include-key`.

```bash
# Print safe Cursor config
qveris mcp configure --target cursor

# Write a working config using the API key from qveris login or QVERIS_API_KEY
qveris mcp configure --target cursor --write --include-key
qveris mcp configure --target claude-desktop --write --include-key
qveris mcp configure --target opencode --write --include-key
qveris mcp configure --target openclaw --write --include-key

# Claude Code uses a shell command instead of a JSON config file
qveris mcp configure --target claude-code
```

Validate a config before restarting the client:

```bash
qveris mcp validate --target cursor
```

For stdio clients, add `--probe` to start the configured MCP server and confirm that `discover`, `inspect`, and `call` are visible via `tools/list`:

```bash
qveris mcp validate --target cursor --probe
```

### Claude Desktop example

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

### Cursor example

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

For environment-specific setup guides, see:

- [SETUP.md](../../agent/SETUP.md)
- [Codex and ChatGPT desktop setup](codex-setup.md)
- [Claude Code setup](claude-code-setup.md)
- [OpenCode setup](opencode-setup.md)
- [IDE / CLI setup](ide-cli-setup.md)

---

## Hosted MCP

QVeris provides a remote Streamable HTTP MCP service. It requires no local package or background process. If the endpoint is not yet available, continue using the local stdio package shown above while the hosted service rollout completes.

```text
https://mcp.qveris.ai/mcp
```

Add the endpoint to a remote-MCP-compatible client and send your QVeris API key on every request:

```json
{
  "mcpServers": {
    "qveris": {
      "type": "http",
      "url": "https://mcp.qveris.ai/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_QVERIS_API_KEY"
      }
    }
  }
}
```

Claude Code can add it from the command line:

```bash
claude mcp add --transport http qveris https://mcp.qveris.ai/mcp --scope user --header "Authorization: Bearer YOUR_QVERIS_API_KEY"
```

Setup flow:

1. Create a key on [Dashboard / API Keys](/account?page=api-keys).
2. Add the endpoint and Bearer header to your client. Store the key in a secret or environment variable when supported; never commit it.
3. Reconnect the client and confirm `discover`, `inspect`, and `call` are visible.

The server validates the key when a session starts and binds that session to the credential. A `401` means the key is missing or invalid; a `503` means validation is temporarily unavailable. Start a new MCP session after changing the key. See the [Hosted MCP page](/hosted-mcp) for a copy-ready setup.

The local stdio package remains available for clients that do not support remote Streamable HTTP MCP.

---

## Available MCP Tools

### 1. `discover`

Use this tool to find capabilities with natural language.

This is the **Discover** action and is **free**.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Natural-language description of the capability you need |
| `limit` | number | No | Max results to return (`1-100`, default `20`) |
| `session_id` | string | No | Session identifier for tracking |
| `view` | string | No | `routing` for compact routing cards; `full` or omitted for complete results |
| `lang` | string | No | Response language: `zh` or `en`; omitted uses server negotiation |

Example:

```json
{
  "query": "weather forecast API",
  "limit": 10,
  "view": "routing",
  "lang": "en"
}
```

Typical response fields:

- `search_id`
- `total`
- `results[]`
- `results[].tool_id`
- `results[].params`
- `results[].examples`
- `results[].stats`

---

### 2. `inspect`

Use this tool to inspect one or more known `tool_id`s before reuse or execution.

This is the **Inspect** action.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tool_ids` | array | Yes | Array of tool IDs to retrieve |
| `search_id` | string | No | Search ID from the discovery that returned the tool(s) |
| `session_id` | string | No | Session identifier for tracking |

Example:

```json
{
  "tool_ids": ["openweathermap.weather.execute.v1"],
  "search_id": "YOUR_SEARCH_ID"
}
```

Use `inspect` when:

- Multiple candidates look similar
- You want to re-check parameters before calling
- You want to inspect success rate or latency
- You are reusing a tool found in an earlier turn

The response schema matches `/search` for the requested tools, including parameters, examples, and stats.

---

### 3. `call`

Use this tool to call a discovered QVeris capability.

The call response may include compact pre-settlement `billing`. Final charge status should be checked with `usage_history` or `credits_ledger`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tool_id` | string | Yes | Tool ID from discovery results |
| `search_id` | string | Yes | Search ID from the discovery that found this tool |
| `params_to_tool` | object | Yes | Dictionary of parameters to pass to the tool |
| `session_id` | string | No | Session identifier for tracking |
| `max_response_size` | number | No | Max response size in bytes (default `20480`) |
| `respond_with` | string | No | `full`, `summary`, or `fields:<JSONPath,...>`; omitted defaults to full |

Example:

```json
{
  "tool_id": "openweathermap.weather.execute.v1",
  "search_id": "YOUR_SEARCH_ID",
  "params_to_tool": {"city": "London", "units": "metric"},
  "respond_with": "summary"
}
```

Projection inputs are opt-in. A legacy `422 extra_forbidden` response causes one retry without only the rejected optional field; invalid projections remain errors.

Typical successful response fields:

- `execution_id`
- `tool_id` when returned by the selected projection
- `success`
- `result.data`, or compact summary fields when requested
- `elapsed_time_ms` or `execution_time`
- `billing` / `pre_settlement_bill` when available

---

### 4. `usage_history`

Use this tool when the user asks whether a call succeeded, failed, or charged credits. It defaults to `summary` mode and does not dump full history into context.

Useful inputs:

- `mode`: `summary`, `search`, or `export_file`
- `execution_id` or `search_id` for precise lookup
- `charge_outcome` for `charged`, `included`, `failed_not_charged`, or `failed_charged_review`
- `min_credits` / `max_credits` for amount ranges
- `start_date` / `end_date` for time windows

Summary mode requests service-side `summary=true` aggregates when available and falls back to bounded client-side aggregation for older deployments.

Examples:

```json
{ "mode": "summary", "bucket": "hour" }
```

```json
{ "mode": "search", "execution_id": "EXECUTION_ID" }
```

### 5. `credits_ledger`

Use this tool when the user asks why their balance changed. It defaults to `summary` mode.

Useful inputs:

- `mode`: `summary`, `search`, or `export_file`
- `direction`: `consume`, `grant`, or `any`
- `entry_type`
- `min_credits` / `max_credits`
- `start_date` / `end_date`

Summary mode requests service-side `summary=true` aggregates when available and falls back to bounded client-side aggregation for older deployments.

Examples:

```json
{ "mode": "summary", "bucket": "day" }
```

```json
{ "mode": "search", "direction": "consume", "min_credits": 50 }
```

Large result sets should use `mode: "export_file"`. The MCP server writes JSONL under `.qveris/exports/` and returns the file path instead of emitting every row.

For very large call outputs, QVeris may return:

- `truncated_content`
- `full_content_file_url`
- `message`

---

## Recommended Usage Pattern

For most agent tasks, use this flow:

1. `discover` to find relevant capabilities
2. `inspect` to review the best candidate(s) when needed
3. `call` to execute the selected capability

In practice:

- If the task is simple and the best candidate is obvious, you may go directly from Discover to Call
- If the task is higher risk or parameters are unclear, insert Inspect before Call
- If you already know a good `tool_id` from a previous turn, re-inspect it before reuse

---

## Session Management

Providing a consistent `session_id` across a single user session helps with:

- User-session continuity
- Better tool selection over time
- More coherent analytics and tracing

If `session_id` is omitted, the MCP server may generate one for the lifetime of the server process.

---

## Troubleshooting

### MCP server does not appear in the client

- Confirm Node.js is installed: `node --version`
- Confirm the client MCP config is valid JSON
- Confirm `QVERIS_API_KEY` is set correctly
- Restart the MCP client after configuration changes

### Tools are visible but calls fail

- Verify the API key is valid
- Verify the selected `tool_id` came from a prior discovery
- Re-run `inspect` to inspect the tool before calling
- Check that `params_to_tool` is a valid object

### Windows-specific issues

If direct `npx` execution fails in some clients, wrap with `cmd /c`:

```json
{
  "command": "cmd",
  "args": ["/c", "npx", "-y", "@qverisai/mcp"]
}
```

---

## Related Docs

- [Getting started](getting-started.md)
- [REST API documentation](rest-api.md)
- [Agent setup guide](../../agent/SETUP.md)
- [MCP/client skill definition](../skills/qveris/SKILL.md)
