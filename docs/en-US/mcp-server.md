# QVeris MCP Server Documentation

## What it is

`@qverisai/mcp` is the official QVeris MCP server for MCP-compatible clients such as Cursor, Claude Desktop, and other coding agents.

It gives agents access to QVeris through three MCP tools:

- `search_tools` = **Discover**
- `get_tools_by_ids` = **Inspect**
- `execute_tool` = **Call**

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
| **Discover** | `search_tools` | `POST /search` |
| **Inspect** | `get_tools_by_ids` | `POST /tools/by-ids` |
| **Call** | `execute_tool` | `POST /tools/execute` |

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

The MCP server reads your API key from:

```bash
QVERIS_API_KEY=your-api-key
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

- [SETUP.md](../SETUP.md)
- [Claude Code setup](claude-code-setup.md)
- [OpenCode setup](opencode-setup.md)
- [IDE / CLI setup](ide-cli-setup.md)

---

## Available MCP Tools

### 1. `search_tools`

Use this tool to discover capabilities with natural language.

This is the **Discover** action and is **free**.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Natural-language description of the capability you need |
| `limit` | number | No | Max results to return (`1-100`, default `20`) |
| `session_id` | string | No | Session identifier for tracking |

Example:

```json
{
  "query": "weather forecast API",
  "limit": 10
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

### 2. `get_tools_by_ids`

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

Use `get_tools_by_ids` when:

- Multiple candidates look similar
- You want to re-check parameters before calling
- You want to inspect success rate or latency
- You are reusing a tool found in an earlier turn

The response schema matches `/search` for the requested tools, including parameters, examples, and stats.

---

### 3. `execute_tool`

Use this tool to call a discovered QVeris capability.

This is the **Call** action and costs **1-100 credits** per invocation, priced by data and task value.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tool_id` | string | Yes | Tool ID from discovery results |
| `search_id` | string | Yes | Search ID from the discovery that found this tool |
| `params_to_tool` | string | Yes | JSON-stringified parameters to pass to the tool |
| `session_id` | string | No | Session identifier for tracking |
| `max_response_size` | number | No | Max response size in bytes (default `20480`) |

Example:

```json
{
  "tool_id": "openweathermap.weather.execute.v1",
  "search_id": "YOUR_SEARCH_ID",
  "params_to_tool": "{\"city\":\"London\",\"units\":\"metric\"}"
}
```

Typical successful response fields:

- `execution_id`
- `tool_id`
- `success`
- `result.data`
- `elapsed_time_ms` or `execution_time`
- `cost`

For very large outputs, QVeris may return:

- `truncated_content`
- `full_content_file_url`
- `message`

---

## Recommended Usage Pattern

For most agent tasks, use this flow:

1. `search_tools` to discover relevant capabilities
2. `get_tools_by_ids` to inspect the best candidate(s) when needed
3. `execute_tool` to call the selected capability

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
- Re-run `get_tools_by_ids` to inspect the tool before calling
- Check that `params_to_tool` is valid JSON

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
- [Agent setup guide](../SETUP.md)
- [MCP/client skill definition](../skills/qveris/SKILL.md)
