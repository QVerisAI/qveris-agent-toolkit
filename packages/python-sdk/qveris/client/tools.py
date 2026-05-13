"""
Qveris tool definitions and default system prompt.

These definitions are designed for OpenAI-compatible chat APIs. The canonical
QVeris Agent External Data & Tool Harness workflow is:

1. `discover` capabilities with a natural-language query.
2. `inspect` one or more candidate `tool_id`s when more detail is needed.
3. `call` the selected capability with parameters.
4. Use `usage_history` or `credits_ledger` when final charge status matters.
"""

from openai.types.chat import ChatCompletionToolParam

DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful assistant that can dynamically discover, inspect, and call "
    "QVeris capabilities to help the user. First think about what kind of capability "
    "is useful for the user's task. Use discover with a query describing the capability, "
    "not the parameters you intend to pass later. If multiple results look relevant, "
    "use inspect to compare parameters, examples, latency, success rate, and billing rules. "
    "Then call a suitable capability using tool_id, search_id, and params_to_tool. "
    "Use usage_history or credits_ledger only when the user asks about charge status, "
    "usage audit, or credit balance movements."
)

DISCOVER_TOOL_DEF: ChatCompletionToolParam = {
    "type": "function",
    "function": {
        "name": "discover",
        "description": "Discover available QVeris capabilities based on a natural-language query.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The capability query, for example weather forecast API or stock price data",
                },
                "limit": {
                    "type": "integer",
                    "description": "The number of results to return, from 1 to 100",
                    "default": 20,
                },
            },
            "required": ["query"],
        },
    },
}

INSPECT_TOOL_DEF: ChatCompletionToolParam = {
    "type": "function",
    "function": {
        "name": "inspect",
        "description": "Inspect one or more QVeris capabilities by tool_id before calling them.",
        "parameters": {
            "type": "object",
            "properties": {
                "tool_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Tool IDs returned by discover",
                },
                "search_id": {
                    "type": "string",
                    "description": "The search_id from the discover response, if available",
                },
            },
            "required": ["tool_ids"],
        },
    },
}

CALL_TOOL_DEF: ChatCompletionToolParam = {
    "type": "function",
    "function": {
        "name": "call",
        "description": "Call a selected QVeris capability with JSON parameters.",
        "parameters": {
            "type": "object",
            "properties": {
                "tool_id": {
                    "type": "string",
                    "description": "The ID of the capability to call, from discover or inspect",
                },
                "search_id": {
                    "type": "string",
                    "description": "The search_id from the discover response",
                },
                "params_to_tool": {
                    "type": "object",
                    "description": "Parameters to pass to the capability",
                },
                "max_response_size": {
                    "type": "integer",
                    "description": "Max response size in bytes; -1 means unlimited",
                },
            },
            "required": ["tool_id", "search_id", "params_to_tool"],
        },
    },
}

# Backward-compatible aliases for older agent loops.
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
