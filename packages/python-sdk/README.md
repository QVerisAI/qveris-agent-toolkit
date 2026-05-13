# QVeris Python SDK

Async Python SDK for the QVeris Agent External Data & Tool Harness workflow: discover, inspect, call, and audit real-world capabilities from your own agents or applications.

## Install

```bash
pip install qveris
```

For local development in this monorepo:

```bash
cd packages/python-sdk
uv run --extra dev python -m pytest
```

## Configuration

```bash
export QVERIS_API_KEY="sk-..."
```

`QverisConfig` also accepts explicit values:

```python
from qveris import QverisClient, QverisConfig

client = QverisClient(QverisConfig(api_key="sk-...", base_url="https://qveris.ai/api/v1"))
```

## Canonical Workflow

```python
import asyncio
from qveris import QverisClient

async def main():
    client = QverisClient()
    try:
        discovered = await client.discover("weather forecast API", limit=5)
        tool = discovered.results[0]

        inspected = await client.inspect([tool.tool_id], search_id=discovered.search_id)
        selected = inspected.results[0]

        params = selected.examples.sample_parameters if selected.examples else {"city": "London"}
        result = await client.call(
            selected.tool_id,
            params,
            search_id=discovered.search_id,
            max_response_size=20480,
        )

        usage = await client.usage(execution_id=result.execution_id, summary=True)
        ledger = await client.ledger(summary=True, limit=5)

        print(result.success, result.billing, usage.total, ledger.total)
    finally:
        await client.close()

asyncio.run(main())
```

First-class typed APIs:

| Method | REST endpoint | Purpose |
|--------|---------------|---------|
| `discover(query, ...)` | `POST /search` | Find capabilities with natural language |
| `inspect(tool_ids, ...)` | `POST /tools/by-ids` | Fetch full capability metadata |
| `call(tool_id, parameters, ...)` | `POST /tools/execute` | Execute a selected capability |
| `usage(...)` | `GET /auth/usage/history/v2` | Audit request status and charge outcome |
| `ledger(...)` | `GET /auth/credits/ledger` | Inspect final credit balance movements |

Backward-compatible aliases remain available: `search_tools`, `get_tools_by_ids`, and `execute_tool`.

## Typed Models

The SDK exposes Pydantic v2 models for the main QVeris Agent External Data & Tool Harness surfaces:

- Capability metadata: `ToolInfo`, `ToolParameter`, `ToolStats`
- Billing: `BillingRule`, `CompactBillingStatement`, `BillingChargeLine`
- Execution: `ToolExecutionResponse`
- Audit: `UsageHistoryResponse`, `UsageEventItem`
- Credits ledger: `CreditsLedgerResponse`, `CreditsLedgerItem`

Models allow additive API fields so newer backend metadata does not break older SDK clients.

## Agent Runtime

`qveris.Agent` wraps the same workflow into an LLM tool loop. It exposes canonical `discover`, `inspect`, and `call` tool definitions to OpenAI-compatible providers.

```python
import asyncio
from qveris import Agent, Message

async def main():
    agent = Agent()
    try:
        messages = [Message(role="user", content="Find a weather capability and explain its parameters.")]
        async for event in agent.run(messages):
            if event.type == "content" and event.content:
                print(event.content, end="", flush=True)
    finally:
        await agent.close()

asyncio.run(main())
```

Set `OPENAI_API_KEY` and optional `OPENAI_BASE_URL` for the default OpenAI-compatible provider, or pass your own `LLMProvider`.

## Integration Patterns

Use the SDK at the level that matches your application:

- Direct typed client: call `discover`, `inspect`, `call`, `usage`, and `ledger` from your own code.
- Built-in streaming agent: use `Agent.run(messages)` and consume `StreamEvent` values for content, tool calls, tool results, metrics, and errors.
- Built-in non-streaming agent: use `Agent.run(messages, stream=False)` when your UI wants complete assistant turns plus events.
- Final text only: use `Agent.run_to_completion(messages)`.
- Bring your own loop: pass `DISCOVER_TOOL_DEF`, `INSPECT_TOOL_DEF`, and `CALL_TOOL_DEF` to your LLM provider, then route tool calls through `QverisClient.handle_tool_call(...)`.

## Custom LLM Providers

The default `Agent()` uses the built-in OpenAI-compatible provider. For non-OpenAI-compatible model APIs, implement `LLMProvider` and pass it to `Agent`:

```python
from typing import AsyncGenerator, List
from openai.types.chat import ChatCompletionToolParam
from qveris import Agent
from qveris.config import AgentConfig
from qveris.llm.base import LLMProvider
from qveris.types import ChatResponse, Message, StreamEvent

class MyProvider(LLMProvider):
    async def chat_stream(
        self,
        messages: List[Message],
        tools: List[ChatCompletionToolParam],
        config: AgentConfig,
    ) -> AsyncGenerator[StreamEvent, None]:
        ...

    async def chat(
        self,
        messages: List[Message],
        tools: List[ChatCompletionToolParam],
        config: AgentConfig,
    ) -> ChatResponse:
        ...

agent = Agent(llm_provider=MyProvider())
```

## Examples

Five runnable examples are included under [`examples/`](examples):

| Example | Scenario |
|---------|----------|
| `finance_research.py` | Stock quote / market data research |
| `risk_compliance.py` | Sanctions, adverse media, or compliance screening |
| `crypto_market.py` | Crypto price and volume data |
| `data_analysis.py` | Dataset enrichment with external capability data |
| `agent_loop_integration.py` | LLM agent loop integration |

The capability examples run `discover` and `inspect` when `QVERIS_API_KEY` is set. They only execute `call` when `RUN_QVERIS_CALLS=1` is set.

## Tests

```bash
cd packages/python-sdk
uv run python -m compileall qveris examples
uv run --extra dev python -m pytest
```

Contract tests use `httpx.MockTransport` to validate SDK models against the REST API shapes for discover, inspect, call, usage, and ledger without consuming credits.

## Compatibility and Release Policy

- Python: `>=3.8`
- Runtime dependencies: `httpx`, `pydantic`, `pydantic-settings`, `openai`
- Public methods and Pydantic model fields follow additive compatibility where possible.
- Deprecated aliases remain for at least one minor release after canonical replacements are available.
- Breaking API changes require a major version bump and migration notes in this README.

## License

MIT
