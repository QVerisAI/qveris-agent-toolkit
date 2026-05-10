"""
Qveris tool definitions and default system prompt.

This module provides the standard tool definitions for the Qveris agent,
using OpenAI's standard ChatCompletionToolParam type.

These definitions are designed to be passed directly to OpenAI-compatible chat
APIs (including many third-party providers that follow the OpenAI tool-calling
schema).

## Tool calling contract

The LLM is expected to:

1. call `search_tools` with a capability query (e.g. "weather forecast", "stock price"),
2. choose a tool from the search results,
3. call `execute_tool` using:
   - `tool_id` from the selected tool
   - `search_id` from the `search_tools` response
   - `params_to_tool` as a **JSON-stringified** object of parameters for that tool.

`qveris.Agent` handles this automatically. If you build your own agent loop,
pair these tool schemas with `qveris.client.api.QverisClient.handle_tool_call(...)`.
"""

from openai.types.chat import ChatCompletionToolParam

# Default system prompt for Qveris agents.
# Kept as a single string so callers can prepend/append to their own prompts.
DEFAULT_SYSTEM_PROMPT = (
    'You are a helpful assistant that can dynamically search and execute tools to help the user. '
    'First think about what kind of tools might be useful to accomplish the user\'s task. '
    'Then use the search_tools tool with query describing the capability of the tool, not what params you want to pass to the tool later. '
    'Then call suitable searched tool(s) using the execute_tool tool, passing parameters to the searched tool through params_to_tool. '
    'If tool has weighted_success_rate and avg_execution_time (in seconds), consider them when selecting which tool to call. '
    'You could reference the examples given if any for each tool. '
    'If this round is search_tools results, be sure to call the tools you think are suitable first. '
    'You could call make multiple tool calls in a single response. '
)

# Search tools definition
SEARCH_TOOL_DEF: ChatCompletionToolParam = {
    "type": "function",
    "function": {
        "name": "search_tools",
        "description": "Search for available tools based on a query. Returns relevant tools that can help accomplish tasks.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to find relevant tools"
                },
                "limit": {
                    "type": "integer",
                    "description": "The number of tools to return (default 10)"
                }
            },
            "required": ["query"]
        }
    }
}

# Execute tool definition
EXECUTE_TOOL_DEF: ChatCompletionToolParam = {
    "type": "function",
    "function": {
        "name": "execute_tool",
        "description": "Execute a specific tool with provided parameters. The tool_id must come from a previous search_tools call.",
        "parameters": {
            "type": "object",
            "properties": {
                "tool_id": {
                    "type": "string",
                    "description": "The ID of the tool to execute (from search results)"
                },
                "search_id": {
                    "type": "string",
                    "description": "The search_id in the response of the search_tools call"
                },
                "params_to_tool": {
                    "type": "string",
                    "description": "A JSON stringified dictionary of parameters to pass to the tool."
                },
                "max_response_size": {
                    "type": "integer",
                    "description": "Max data size in bytes (default 20480)"
                }
            },
            "required": ["tool_id", "search_id", "params_to_tool"]
        }
    }
}

__all__ = ["DEFAULT_SYSTEM_PROMPT", "SEARCH_TOOL_DEF", "EXECUTE_TOOL_DEF"]
