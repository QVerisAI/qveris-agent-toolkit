# @qverisai/mcp

Official QVeris MCP Server — Dynamically search and execute tools via natural language.

[![npm version](https://img.shields.io/npm/v/@qverisai/mcp.svg)](https://www.npmjs.com/package/@qverisai/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

This SDK provides a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that enables LLMs to discover and execute third-party tools through the QVeris API. With three simple tools, your AI assistant can:

- **Search** for tools using natural language queries
- **Get** detailed information about specific tools by their IDs
- **Execute** any discovered tool with the appropriate parameters

## Quick Start

### 1. Get Your API Key

Visit [QVeris](https://qveris.ai) (Global) or [QVeris](https://qveris.cn) (China) to get your API key.

### 2. Configure Your MCP Client

Add the QVeris server to your MCP client configuration:

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "qveris": {
      "command": "npx",
      "args": ["@qverisai/mcp"],
      "env": {
        "QVERIS_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**Cursor** (Settings → MCP Servers):

```json
{
  "mcpServers": {
    "qveris": {
      "command": "npx",
      "args": ["@qverisai/mcp"],
      "env": {
        "QVERIS_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### 3. Start Using

Once configured, You could add this to system prompt:

> "You can use qveris MCP Server to dynamically search and execute tools to help the user. First think about what kind of tools might be useful to accomplish the user's task. Then use the search_tools tool with query describing the capability of the tool, not what params you want to pass to the tool later. Then call a suitable searched tool using the execute_tool tool, passing parameters to the searched tool through params_to_tool. You could reference the examples given if any for each tool. You may call make multiple tool calls in a single response."

Then your AI assistant can search for and execute tools:

> "Find me a weather tool and get the current weather in Tokyo"

The assistant will:
1. Call `search_tools` with query "weather"
2. Review the results and select an appropriate tool
3. Call `execute_tool` with the tool_id and parameters

## Available Tools

### `search_tools`

Search for available tools based on natural language queries.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | ✓ | Natural language description of the capability you need |
| `limit` | number | | Max results to return (1-100, default: 20) |
| `session_id` | string | | Session identifier for tracking (auto-generated if omitted) |

**Example:**

```json
{
  "query": "send email notification",
  "limit": 10
}
```

### `execute_tool`

Execute a discovered tool with specific parameters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tool_id` | string | ✓ | Tool ID from search results |
| `search_id` | string | ✓ | Search ID from the search that found this tool |
| `params_to_tool` | object | ✓ | A dictionary of parameters to pass to the tool |
| `session_id` | string | | Session identifier (auto-generated if omitted) |
| `max_response_size` | number | | Max response size in bytes (default: 20480) |

**Example:**

```json
{
  "tool_id": "openweathermap.weather.execute.v1",
  "search_id": "abcd1234-ab12-ab12-ab12-abcdef123456",
  "params_to_tool": {"city": "London", "units": "metric"}
}
```

### `get_tools_by_ids`

Get detailed descriptions of tools based on their tool IDs. Useful for retrieving information about specific tools when you already know their IDs from previous searches.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tool_ids` | array | ✓ | Array of tool IDs to retrieve (at least one required) |
| `search_id` | string | | Search ID from the search that returned the tool(s) |
| `session_id` | string | | Session identifier (auto-generated if omitted) |

**Example:**

```json
{
  "tool_ids": ["openweathermap.weather.execute.v1", "worldbank_refined.search_indicators.v1"],
  "search_id": "abcd1234-ab12-ab12-ab12-abcdef123456"
}
```

## Session Management

Providing a consistent `session_id` in a same user session in any tool call enables:
- Consistent user tracking across multiple tool calls
- Better analytics and usage patterns
- Improved tool recommendations over time

If not provided, the SDK automatically generates and maintains a session ID for the lifetime of the server process. However, this result in a much larger granularity of user sessions.

## Response Handling

### Successful Execution

```json
{
  "execution_id": "abcd1234-ab12-ab12-ab12-abcdef123456",
  "tool_id": "openweathermap.weather.execute.v1",
  "success": true,
  "result": {
    "data": {
      "temperature": 15.5,
      "humidity": 72,
      "description": "partly cloudy"
    }
  },
  "execution_time": 0.847
}
```

### Large Responses

When tool output exceeds `max_response_size`, you'll receive:

```json
{
  "result": {
    "message": "Result content is too long...",
    "truncated_content": "[[1678233600000, \"22198.56...",
    "full_content_file_url": "https://..."
  }
}
```

The `full_content_file_url` is valid for 120 minutes.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `QVERIS_API_KEY` | ✓ | Your QVeris API key |
| `QVERIS_REGION` | | Force region: `global` or `cn` (auto-detected from key prefix if not set) |
| `QVERIS_BASE_URL` | | Override API base URL (highest priority, for custom endpoints) |

## Region

Region is auto-detected from your API key prefix — no extra configuration needed.

| Key prefix | Region | API endpoint |
|------------|--------|--------------|
| `sk-xxx` | Global | `https://qveris.ai/api/v1` |
| `sk-cn-xxx` | China | `https://qveris.cn/api/v1` |

To override manually, set environment variables in your MCP client config:

```json
{
  "mcpServers": {
    "qveris": {
      "command": "npx",
      "args": ["-y", "@qverisai/mcp"],
      "env": {
        "QVERIS_API_KEY": "your-api-key",
        "QVERIS_REGION": "cn"
      }
    }
  }
}
```

**Priority:** `QVERIS_BASE_URL` > `QVERIS_REGION` > API key prefix auto-detection > default (global)

## Requirements

- Node.js 18.0.0 or higher
- A valid QVeris API key ([qveris.ai](https://qveris.ai) or [qveris.cn](https://qveris.cn))

## Development

```bash
# Clone the repository
git clone https://github.com/QVerisAI/QVerisAI.git
cd QVerisAI/packages/mcp

# Install dependencies
npm install

# Build
npm run build

# Run locally
QVERIS_API_KEY=your-key node dist/index.js
```

## License

MIT © [QVerisAI](https://github.com/QVerisAI)

## Support

- 🐛 [Issue Tracker](https://github.com/QVerisAI/QVerisAI/issues)
- 💬 Contact: contact@qveris.ai

