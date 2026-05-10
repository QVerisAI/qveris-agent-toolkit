# QVeris Python SDK

Empower LLM agents with [**QVeris**](https://qveris.ai): dynamically discover, inspect, call, and audit thousands of live capabilities (APIs, data sources, automations) in a tight agent loop.

## What QVeris is

QVeris provides a **capability routing** layer for agents:

- **discover**: the agent can call `search_tools` with a natural-language capability query (e.g. “stock price”, “web search”, “send email”).
- **call**: after selecting a capability from search results, the agent calls `execute_tool` with the tool id + parameters.

The `qveris.Agent` wraps this into a loop that:

- searches for suitable tools to complete the task,
- executes proper tools (and your extra tools, if provided),
- feeds tool outputs back into the LLM until it reaches a final answer.

## Configuration

Set the following environment variables (or pass them via `QverisConfig` / provider configs):

- `QVERIS_API_KEY`: Your QVeris API key. (Get it from [QVeris](https://qveris.ai))
- `OPENAI_API_KEY`: Your OpenAI (or OpenAI-compatible) provider API key.
- `OPENAI_BASE_URL`: Base URL for OpenAI-compatible providers (e.g. OpenAI, OpenRouter etc).

## Quick Start

```python
import asyncio
from qveris import Agent, Message

async def main():
    # Uses env vars automatically (QVERIS_API_KEY / OPENAI_API_KEY / ...)
    agent = Agent()

    messages = [
        Message(role="user", content="Find a weather tool and check New York weather.")
    ]

    print("Assistant: ", end="", flush=True)
    async for event in agent.run(messages):  # streaming by default
        if event.type == "content" and event.content:
            print(event.content, end="", flush=True)
        elif event.type == "tool_result" and event.tool_result:
            tr = event.tool_result
            name = tr.get("name", "unknown")
            is_error = tr.get("is_error", False)
            result = tr.get("result")
            print(f"\n← tool_result: {name} (error={is_error})", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
```

## Examples

This package includes two example scripts that show different integration styles:

- **Interactive streaming chat** (`examples/interactive_chat.py`): a terminal chat UI that streams tokens and prints tool calls/results as they happen (great for debugging and demos).
- **Stock debate** (`examples/stock_debate.py`): two agents debate NVIDIA using non-streaming turns while still surfacing tool calls/results (demonstrates multi-agent orchestration and different models).

## Integration patterns

QVeris supports several ways to integrate, depending on how much control you want over events and UI.

### (a) Built-in streaming agent

Use `Agent.run(messages)` (streaming is the default). You’ll receive `StreamEvent`s as the model streams content and as tools are invoked.

### (b) Built-in non-streaming agent, and you need events (tool calls/results, metrics, etc.)

Use `Agent.run(messages, stream=False)` and handle `StreamEvent`s:

- `content` (full assistant message, non-streaming)
- `tool_call` (what the model asked to run)
- `tool_result` (what actually ran + output)
- `metrics` (token usage if available)
- `error`

### (c) Built-in non-streaming agent, final message only

If you only need the final assistant text (no tool-calls), use:

```python
final_text = await agent.run_to_completion(messages)
```

### (d) Bring your own agent loop (use QVeris client + tool definitions directly)

If you already have an agent framework (or want full control), you can directly use:

- `qveris.client.tools.SEARCH_TOOL_DEF` / `EXECUTE_TOOL_DEF` to expose tool schemas to your LLM
- `qveris.client.tools.DEFAULT_SYSTEM_PROMPT` as a starting system prompt
- `qveris.client.api.QverisClient` to handle QVeris tool calls

Your loop is responsible for:

- sending messages + tool schemas to the LLM,
- detecting tool calls,
- calling `QverisClient.handle_tool_call(...)`,
- appending tool results back into messages until completion.

## Custom LLM providers (non-OpenAI compatible APIs)

By default, `Agent()` uses an internal OpenAI-compatible provider. If your model API is **not** OpenAI-compatible, implement a provider that follows `LLMProvider` (`qveris/llm/base.py`) and pass it to `Agent`:

```python
from typing import AsyncGenerator, List
from qveris.llm.base import LLMProvider
from qveris.types import Message, StreamEvent, ChatResponse
from openai.types.chat import ChatCompletionToolParam
from qveris.config import AgentConfig

class MyProvider(LLMProvider):
    async def chat_stream(
        self,
        messages: List[Message],
        tools: List[ChatCompletionToolParam],
        config: AgentConfig,
    ) -> AsyncGenerator[StreamEvent, None]:
        # Yield StreamEvent(type="content", content="...") and/or tool_call/metrics/etc.
        ...

    async def chat(
        self,
        messages: List[Message],
        tools: List[ChatCompletionToolParam],
        config: AgentConfig,
    ) -> ChatResponse:
        # Return ChatResponse(content="...", tool_calls=[...], metrics={...})
        ...

agent = Agent(llm_provider=MyProvider())
```

## Features

- **Provider Agnostic**: Works with OpenAI, OpenRouter, LocalAI, etc.
- **Auto-Tool Execution**: The agent automatically searches for tools, executes them, and returns results.
- **Smart Context**: Automatically prunes old tool results to save tokens (`enable_history_pruning=True`).
- **Multiple Agents**: Configure different agents with unique system prompts and temperatures.
- **Reasoning Support**: Captures reasoning traces from models like Gemini (via OpenRouter) or DeepSeek.
