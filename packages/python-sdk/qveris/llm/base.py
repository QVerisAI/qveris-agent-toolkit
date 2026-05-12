"""
LLM provider contract for Qveris agents.

`LLMProvider` is a small Protocol describing what the `qveris.Agent` needs from an LLM runtime:

- a streaming chat API that yields `StreamEvent` objects (`chat_stream`)
- a non-streaming chat API that returns a `ChatResponse` (`chat`)

This protocol allows you to plug in:

- OpenAI / OpenAI-compatible providers (default implementation lives in `qveris.llm.openai`)
- non-OpenAI-compatible model APIs (implement this protocol and pass `llm_provider=...` to `Agent`)

## Tool call format

Qveris uses the OpenAI tool-calling schema (also used by many compatible providers).
When emitting a tool call, providers should surface a dict shaped like:

```python
{
  "id": "<call-id>",
  "type": "function",
  "function": {
    "name": "discover" | "inspect" | "call" | "<your-extra-tool-name>",
    "arguments": "<json-string>"
  }
}
```

Where `arguments` is a JSON-encoded string. For Qveris built-ins:

- `discover` expects `{"query": "...", "limit": 20}` (limit optional)
- `inspect` expects `{"tool_ids": ["..."], "search_id": "..."}`
- `call` expects `{"tool_id": "...", "search_id": "...", "params_to_tool": "<json-string>", "max_response_size": 20480}`

Deprecated names `search_tools`, `get_tools_by_ids`, and `execute_tool` are still accepted by
`QverisClient.handle_tool_call(...)` for backward compatibility.

## Event types

In streaming mode, providers typically yield multiple events over time:

- `StreamEvent(type="content", content="...")` (delta chunks)
- `StreamEvent(type="tool_call", tool_call={...})` (one or more tool calls)
- `StreamEvent(type="metrics", metrics={...})` (optional token usage/timing)

Some providers additionally support:

- `StreamEvent(type="reasoning", content="...")`
- `StreamEvent(type="reasoning_details", details=[...])`
"""

from typing import AsyncGenerator, List, Protocol

from openai.types.chat import ChatCompletionToolParam

from ..config import AgentConfig
from ..types import ChatResponse, Message, StreamEvent

class LLMProvider(Protocol):
    """
    Interface for LLM providers (OpenAI, Anthropic, local runtimes, etc.).

    Implementations should be:

    - **async**: both methods are awaited by the agent loop
    - **tool-aware**: accept OpenAI-style tool schemas and surface tool calls when the model requests them
    - **eventful**: in streaming mode, yield `StreamEvent`s (content/tool_call/metrics...)
    """
    async def chat_stream(
        self,
        messages: List[Message],
        tools: List[ChatCompletionToolParam],
        config: AgentConfig
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        Stream chat completions from the LLM.

        Args:
            messages: Conversation messages in OpenAI-style roles (`system`, `user`, `assistant`, `tool`).
            tools: OpenAI-compatible tool schemas to expose to the model.
            config: Agent/LLM config (model name, temperature, and provider-specific hints).

        Yields:
            `StreamEvent` objects, usually including:
            - `content` (delta chunks)
            - `tool_call` (when the model requests tool execution)
            - `metrics` (optional)
        """
        ...

    async def chat(
        self,
        messages: List[Message],
        tools: List[ChatCompletionToolParam],
        config: AgentConfig
    ) -> ChatResponse:
        """
        Non-streaming chat completion from the LLM.

        Implementations should return:

        - `ChatResponse.content`: final assistant message text (if any)
        - `ChatResponse.tool_calls`: list of tool calls the model wants to execute (if any)
        - `ChatResponse.metrics`: usage metadata if available
        - `ChatResponse.reasoning_details`: optional provider-specific data
        """
        ...
