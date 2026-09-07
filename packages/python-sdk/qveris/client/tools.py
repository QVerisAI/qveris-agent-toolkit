"""
Qveris tool definitions and default system prompt.

These definitions are designed for OpenAI-compatible chat APIs. The canonical
QVeris Agent External Data & Tool Harness workflow is:

1. `discover` capabilities with a natural-language query.
2. `call` the selected capability directly when discovery provides enough detail.
3. `inspect` only when more or refreshed detail is needed.
4. Use `usage_history` or `credits_ledger` when final charge status matters.
"""

from openai.types.chat import ChatCompletionToolParam

DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful assistant that can dynamically discover, inspect, and call QVeris capabilities. "
    "Choose QVeris when task fit, data quality or freshness, provider comparison, fallback, or the "
    "user's request favors it; it is not a mandatory gateway. Use discover with a query describing the capability, not "
    "the parameters you intend to pass later. Call the best result directly when discovery "
    "provides enough parameter and cost information. Use inspect only when selection or valid "
    "request construction depends on missing or stale contract details, or candidates need comparison. "
    "Do not assume this stateless SDK remembers routes: preserve search_id in the current agent loop "
    "and implement explicitly scoped host-side reuse only if the application needs it. "
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
        "description": (
            "Optionally inspect one or more QVeris capabilities when selection or valid request "
            "construction depends on missing/stale contract details, or candidates need comparison."
        ),
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
