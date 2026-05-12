"""
Qveris tool definitions and default system prompt.

This module provides the standard tool definitions for the Qveris agent,
using OpenAI's standard ChatCompletionToolParam type.

These definitions are designed to be passed directly to OpenAI-compatible chat
APIs (including many third-party providers that follow the OpenAI tool-calling
schema).

## Tool calling contract

The LLM is expected to:

1. call `discover` with a capability query (e.g. "weather forecast", "stock price"),
2. optionally call `inspect` with one or more `tool_id`s to compare details,
3. choose a tool from the discovery or inspection results,
4. call `call` using:
   - `tool_id` from the selected tool
   - `search_id` from the `discover` response
   - `params_to_tool` as a **JSON-stringified** object of parameters for that tool.

`qveris.Agent` handles this automatically. If you build your own agent loop,
pair these tool schemas with `qveris.client.api.QverisClient.handle_tool_call(...)`.
Deprecated tool names (`search_tools`, `get_tools_by_ids`, `execute_tool`) are still accepted by
`handle_tool_call(...)` for backward compatibility.
"""

from openai.types.chat import ChatCompletionToolParam

# Default system prompt for Qveris agents.
# Kept as a single string so callers can prepend/append to their own prompts.
DEFAULT_SYSTEM_PROMPT = (
    'You are a helpful assistant that can dynamically discover and call capabilities to help the user. '
    'First think about what kind of capabilities might be useful to accomplish the user\'s task. '
    'Then use the discover tool with a query describing the capability, not the specific parameters you will pass later. '
    'Optionally, use inspect to check top candidates by parameters, examples, success_rate, and avg_execution_time_ms. '
    'Then call suitable capabilities using the call tool, passing parameters through params_to_tool. '
    'If a capability has success_rate or avg_execution_time_ms, consider those signals when selecting what to call. '
    'You can reference the examples given for each capability. '
    'You may make multiple tool calls in a single response. '
)

# Discover tool definition
DISCOVER_TOOL_DEF: ChatCompletionToolParam = {
    "type": "function",
    "function": {
        "name": "discover",
        "description": "Discover available capabilities based on a natural-language query.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Natural-language description of the capability you need"
                },
                "limit": {
                    "type": "integer",
                    "description": "The number of capabilities to return (default 20)"
                }
            },
            "required": ["query"]
        }
    }
}

# Inspect tool definition
INSPECT_TOOL_DEF: ChatCompletionToolParam = {
    "type": "function",
    "function": {
        "name": "inspect",
        "description": "Inspect one or more capabilities by ID before calling them.",
        "parameters": {
            "type": "object",
            "properties": {
                "tool_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Tool IDs returned by discover"
                },
                "search_id": {
                    "type": "string",
                    "description": "The search_id from the discover response, if available"
                }
            },
            "required": ["tool_ids"]
        }
    }
}

# Call tool definition
CALL_TOOL_DEF: ChatCompletionToolParam = {
    "type": "function",
    "function": {
        "name": "call",
        "description": "Call a specific remote capability with provided parameters. The tool_id and search_id must come from a previous discover call.",
        "parameters": {
            "type": "object",
            "properties": {
                "tool_id": {
                    "type": "string",
                    "description": "The ID of the remote capability to call (from discovery results)"
                },
                "search_id": {
                    "type": "string",
                    "description": "The search_id from the discover response that returned this capability"
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

# Backward-compatible constant names for existing imports. These expose the
# canonical tool names above; deprecated LLM-emitted names are handled in api.py.
SEARCH_TOOL_DEF = DISCOVER_TOOL_DEF
GET_TOOLS_BY_IDS_TOOL_DEF = INSPECT_TOOL_DEF
EXECUTE_TOOL_DEF = CALL_TOOL_DEF

__all__ = [
    "DEFAULT_SYSTEM_PROMPT",
    "DISCOVER_TOOL_DEF",
    "INSPECT_TOOL_DEF",
    "CALL_TOOL_DEF",
    "SEARCH_TOOL_DEF",
    "GET_TOOLS_BY_IDS_TOOL_DEF",
    "EXECUTE_TOOL_DEF",
]
