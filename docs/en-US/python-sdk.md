# QVeris Python SDK

QVeris Python SDK v0.5.0 is the latest tested release. Use its async client to discover, inspect, probe, call, and audit 10,000+ real-world API capabilities from your own agents and applications.

The SDK gives you two levels of control:

- **`QverisClient`** — a thin typed wrapper over the QVeris REST API (`discover`, `inspect`, `probe`, `call`, `usage`, `ledger`).
- **`Agent`** — a ready-made LLM tool loop that lets a model discover and call capabilities on its own.

Use the client when you want full control, or the agent when you want a working assistant in a few lines.

## Installation

```bash
pip install qveris
```

Requires Python 3.8+. Runtime dependencies: `httpx`, `pydantic`, `pydantic-settings`, `openai`.

## Authentication

The SDK reads your API key from the `QVERIS_API_KEY` environment variable:

```bash
export QVERIS_API_KEY="sk-..."
```

Create a key in [Dashboard / API Keys](/account?page=api-keys). You can also pass configuration explicitly:

```python
from qveris import QverisClient, QverisConfig

client = QverisClient(QverisConfig(api_key="sk-..."))
```

Endpoint priority is `QverisConfig(base_url=...)` > `QVERIS_BASE_URL` > `https://qveris.ai/api/v1`. API keys never select the endpoint. Overrides must be HTTP(S) URLs without credentials, a query string, or a fragment.

## Quickstart

The core workflow is **discover → inspect → call**, then optionally **audit** what happened. All methods are `async`.

```python
import asyncio
from qveris import QverisClient

async def main():
    client = QverisClient()
    try:
        # 1. Discover capabilities with natural language (free)
        discovered = await client.discover("weather forecast API", limit=5)
        tool = discovered.results[0]

        # 2. Inspect the selected capability for full parameters
        inspected = await client.inspect([tool.tool_id], search_id=discovered.search_id)
        selected = inspected.results[0]

        # 3. Probe candidate parameters and quote without execution or credits
        params = (
            selected.examples.sample_parameters
            if selected.examples and selected.examples.sample_parameters
            else {"city": "London"}
        )
        probe = await client.probe(selected.tool_id, params, checks=["schema", "quote"])

        # 4. Call it (may consume credits)
        result = await client.call(
            selected.tool_id,
            params,
            search_id=discovered.search_id,
            max_response_size=20480,
        )
        print(result.success, result.result)

        # 5. Audit the final charge outcome
        usage = await client.usage(execution_id=result.execution_id, summary=True)
        ledger = await client.ledger(summary=True, limit=5)
        print(usage.total, ledger.total)
    finally:
        await client.close()

asyncio.run(main())
```

> `QverisClient` owns an HTTP connection pool. Always `await client.close()` when you are done (e.g. in a `finally` block).

## The Agent

`Agent` wraps the same workflow into an LLM tool loop. The model is given the `discover`, `inspect`, and `call` tools and decides when to use them.

The default agent uses an OpenAI-compatible provider, so set:

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://api.openai.com/v1"   # optional; for OpenAI-compatible providers
```

### Streaming

```python
import asyncio
from qveris import Agent, Message

async def main():
    async with Agent() as agent:
        messages = [Message(role="user", content="Check the current weather in New York.")]
        async for event in agent.run(messages):
            if event.type == "content" and event.content:
                print(event.content, end="", flush=True)

asyncio.run(main())
```

`Agent` is an async context manager — `async with Agent() as agent:` closes network resources automatically.

### Final text only

When you just want the finished answer:

```python
async with Agent() as agent:
    answer = await agent.run_to_completion(
        [Message(role="user", content="Find a stock quote capability and quote AAPL.")]
    )
    print(answer)
```

### Event types

`Agent.run(messages)` yields `StreamEvent` objects. Inspect `event.type`:

| `type` | Meaning |
|--------|---------|
| `content` | Assistant text (delta chunks when streaming, full message otherwise) |
| `reasoning` / `reasoning_details` | Optional reasoning tokens / structured reasoning from some providers |
| `tool_call` | The model is invoking `discover` / `inspect` / `call` (or one of your extra tools) |
| `tool_result` | Output of an executed tool call (`event.tool_result` has `name`, `result`, `is_error`) |
| `metrics` | Token usage / timing, when the provider reports it |
| `error` | Fatal error that ended the run |
| `budget_warning` / `budget_exceeded` | Session spend crossed the warn threshold / a call was blocked to stay within budget (see [Budget guard](#budget-guard)) |

Pass `stream=False` to `run(...)` to receive complete assistant turns instead of deltas.

### Budget guard

Set a per-session credit budget to bound autonomous spend:

```python
agent = Agent(budget_credits=25)
```

When set, the agent learns each capability's `expected_cost` from `discover` / `inspect` and **blocks a `call` projected to exceed the budget before the request is sent** — emitting a `budget_exceeded` event so the model can pick a cheaper capability or stop. It accumulates actual spend from `call` billing and emits a single `budget_warning` as spend approaches the limit. Query the state any time:

```python
status = agent.budget_status()   # {"limit": 25, "spent": 12.0, "remaining": 13.0}, or None
```

`spent` reflects pre-settlement charges — reconcile final charges with `usage(...)` / `ledger(...)`. Capabilities whose cost is unknown are not blocked (they cannot be estimated). Without `budget_credits`, agent behavior is unchanged.

## Configuration reference

### `QverisConfig`

| Field | Env var | Default | Description |
|-------|---------|---------|-------------|
| `api_key` | `QVERIS_API_KEY` | `None` | API key, sent as `Authorization: Bearer ...` |
| `base_url` | `QVERIS_BASE_URL` | `https://qveris.ai/api/v1` | API base URL |
| `enable_history_pruning` | — | `True` | Prune/compress old tool outputs to save tokens (agent loop) |
| `max_iterations` | — | `50` | Max agent tool-loop iterations |

### `AgentConfig`

| Field | Default | Description |
|-------|---------|-------------|
| `model` | `gpt-4o` | Model name passed to the active LLM provider |
| `additional_system_prompt` | `None` | Appended to the default tool-use system prompt |
| `temperature` | `0.7` | Forwarded to the provider when supported |

```python
from qveris import Agent, QverisConfig, AgentConfig

agent = Agent(
    config=QverisConfig(max_iterations=20),
    agent_config=AgentConfig(model="gpt-4o", temperature=0.2),
)
```

## API reference

The [source-generated API reference](python-sdk-api.md) lists the current
public client, agent, configuration, and response-model signatures. Sphinx
regenerates it from the Python objects and docstrings, and CI checks it for
drift.

### `QverisClient`

| Method | REST endpoint | Purpose |
|--------|---------------|---------|
| `discover(query, limit=20, session_id=None, view=None, lang=None)` | `POST /search` | Find capabilities; `view="routing"` returns compact routing cards (free) |
| `inspect(tool_ids, search_id=None, session_id=None)` | `POST /tools/by-ids` | Fetch full capability metadata (free) |
| `call(tool_id, parameters, search_id=None, session_id=None, max_response_size=None, respond_with=None)` | `POST /tools/execute` | Execute a capability; select full, summary, or JSONPath fields |

Projection arguments are opt-in. A legacy `422 extra_forbidden` response causes one retry without only the rejected optional field; invalid projections remain errors.
| `usage(**filters)` | `GET /auth/usage/history/v2` | Audit request status and charge outcome |
| `ledger(**filters)` | `GET /auth/credits/ledger` | Inspect final credit balance movements |
| `handle_tool_call(func_name, func_args, session_id=None)` | — | Bridge an LLM tool call to the right QVeris method |
| `close()` | — | Close the underlying HTTP client |

`tool_ids` accepts a single string or an iterable. `usage(...)` and `ledger(...)` take keyword-only filters such as `start_date`, `end_date`, `summary` (default `True`), `bucket`, `charge_outcome`, `execution_id`, `search_id`, `direction`, `entry_type`, `min_credits`, `max_credits`, `limit`, `page`, `page_size`.

Backward-compatible aliases remain available: `search_tools` → `discover`, `get_tools_by_ids` → `inspect`, `execute_tool` → `call`.

### `Agent`

| Member | Description |
|--------|-------------|
| `run(messages, stream=True)` | Async generator of `StreamEvent`; primary integration API |
| `run_to_completion(messages)` | Non-streaming; returns the final assistant text |
| `get_last_messages()` | Conversation history from the last `run(...)`, including tool calls/results |
| `new_session()` | Reset the correlation/session id |
| `close()` | Close network resources (or use `async with`) |

Constructor: `Agent(config=None, agent_config=None, llm_provider=None, extra_tools=None, extra_tool_handler=None, debug_callback=None)`.

## Typed models

The SDK returns Pydantic v2 models, so you get autocomplete and validation. Unknown backend fields are preserved, so newer API metadata will not break older SDK clients.

- Discovery / inspect: `SearchResponse` → `results: list[ToolInfo]`; `ToolInfo` has `tool_id`, `name`, `description`, `params: list[ToolParameter]`, `examples`, `stats`, `billing_rule`.
- Call: `ToolExecutionResponse` with `execution_id`, `success`, `result`, `error_message`, `billing` (`CompactBillingStatement`), `cost`, `remaining_credits`.
- Usage audit: `UsageHistoryResponse` → `items: list[UsageEventItem]`, `total`, `summary`.
- Credits ledger: `CreditsLedgerResponse` → `items: list[CreditsLedgerItem]`, `total`, `summary`.

```python
from qveris import ToolExecutionResponse

def explain(result: ToolExecutionResponse) -> str:
    if not result.success:
        return f"failed: {result.error_message}"
    charged = result.billing.summary if result.billing else "no billing info"
    return f"ok ({charged}); remaining={result.remaining_credits}"
```

## Integration patterns

Use the level that matches your application:

- **Direct typed client** — call `discover`/`inspect`/`call`/`usage`/`ledger` from your own code.
- **Built-in streaming agent** — `Agent.run(messages)` and consume `StreamEvent` values.
- **Built-in non-streaming agent** — `Agent.run(messages, stream=False)` for complete turns plus events.
- **Final text only** — `Agent.run_to_completion(messages)`.
- **Bring your own loop** — expose the QVeris tool schemas to your own LLM provider, then route tool calls back through the client:

```python
from qveris import QverisClient
from qveris.client.tools import DISCOVER_TOOL_DEF, INSPECT_TOOL_DEF, CALL_TOOL_DEF

tools = [DISCOVER_TOOL_DEF, INSPECT_TOOL_DEF, CALL_TOOL_DEF]
client = QverisClient()

# ... your LLM emits a tool call (func_name, func_args) ...
result, is_error, handled = await client.handle_tool_call(func_name, func_args)
if handled and not is_error:
    ...  # feed result back to your model
```

### Framework integrations

Expose the QVeris discover/inspect/call workflow as native tools for popular agent frameworks. Adapters import their framework lazily, so the base `qveris` package never depends on them.

| Framework | Native tool type | Adapter install | Complete agent setup |
|-----------|------------------|-----------------|----------------------|
| LangChain / LangGraph | `StructuredTool` | `pip install "qveris[langchain]"` (adapter: Python 3.9+) | The current `create_agent` example requires Python 3.10+, `langchain>=1.0`, and a model-provider package. |
| OpenAI Agents SDK | `FunctionTool` | `pip install "qveris[openai-agents]"` (Python 3.10+) | Pass the tools to `Agent`; close with `await client.close()`. |
| CrewAI | `BaseTool` | `pip install "qveris[crewai]"` (Python 3.10+) | Tools are sync/async bridged; close with `aclose(client)`. |
| AutoGen | `autogen_core.tools.FunctionTool` | `pip install "qveris[autogen]"` (Python 3.10+) | Also install `autogen-agentchat` and a model extension such as `autogen-ext[openai]`. |
| LlamaIndex | `llama_index.core.tools.FunctionTool` | `pip install "qveris[llamaindex]"` (Python 3.10+) | Also install the model integration used by `FunctionAgent`; use an async agent or `await tool.acall(...)`. |
| Pydantic AI | `pydantic_ai.Tool` | `pip install "qveris[pydantic-ai]"` (Python 3.10+) | The extra is slim; add a provider extra such as `pydantic-ai-slim[openai]`. |

Every `get_qveris_tools(client, session_id=...)` call returns exactly three tools: `qveris_discover`, `qveris_inspect`, and `qveris_call`. Results, including QVeris error payloads, are JSON strings so the agent can inspect them and recover. `discover` is free and returns a `search_id`; pass that ID to `inspect` and `call`. A complete agent run needs `QVERIS_API_KEY` plus the API key required by its model provider.

**LangChain and LangGraph**

Use LangChain's current `create_agent` API. It runs on LangGraph; custom LangGraph workflows can put the same tools in a `ToolNode`.

```bash
pip install "qveris[langchain]" "langchain>=1.0" langchain-openai
```

```python
import asyncio

from langchain.agents import create_agent
from qveris import QverisClient
from qveris.integrations.langchain import get_qveris_tools

async def main():
    client = QverisClient()
    try:
        agent = create_agent("openai:gpt-4o-mini", tools=get_qveris_tools(client))
        result = await agent.ainvoke({"messages": [{"role": "user", "content": "Find a stock quote tool and quote AAPL."}]})
        print(result)
    finally:
        await client.close()

asyncio.run(main())
```

**OpenAI Agents SDK**

```python
import asyncio

from agents import Agent, Runner
from qveris import QverisClient
from qveris.integrations.openai_agents import get_qveris_tools

async def main():
    client = QverisClient()
    try:
        agent = Agent(name="Assistant", tools=get_qveris_tools(client))
        result = await Runner.run(agent, "Find a stock quote capability and quote AAPL.")
        print(result.final_output)
    finally:
        await client.close()

asyncio.run(main())
```

**CrewAI**

```python
from crewai import Agent
from qveris import QverisClient
from qveris.integrations.crewai import aclose, get_qveris_tools

client = QverisClient()
agent = Agent(role="Researcher", goal="Use the right capability", backstory="Tool specialist", tools=get_qveris_tools(client))
# Crew(...).kickoff()
aclose(client)
```

CrewAI's client connections run on the adapter's dedicated event loop, so use `aclose(client)` rather than `await client.close()`.

**AutoGen, LlamaIndex, and Pydantic AI**

```python
# The following snippets assume a configured QverisClient plus the framework's
# model_client / llm. Choose the adapter that matches your agent framework.
# AutoGen AssistantAgent
from autogen_agentchat.agents import AssistantAgent
from qveris.integrations.autogen import get_qveris_tools

agent = AssistantAgent("assistant", model_client=model_client, tools=get_qveris_tools(client))

# LlamaIndex FunctionAgent
from llama_index.core.agent.workflow import FunctionAgent
from qveris.integrations.llamaindex import get_qveris_tools

agent = FunctionAgent(tools=get_qveris_tools(client), llm=llm)

# Pydantic AI Agent
from pydantic_ai import Agent
from qveris.integrations.pydantic_ai import get_qveris_tools

agent = Agent("openai:gpt-4o-mini", tools=get_qveris_tools(client))
```

See the runnable examples below for provider setup and complete client cleanup. The TypeScript SDK ships a Vercel AI SDK adapter.

### Custom LLM providers

The default `Agent()` uses the built-in OpenAI-compatible provider. For other model APIs, implement `LLMProvider` and pass it in:

```python
from typing import AsyncGenerator, List
from openai.types.chat import ChatCompletionToolParam
from qveris import Agent
from qveris.config import AgentConfig
from qveris.llm.base import LLMProvider
from qveris.types import ChatResponse, Message, StreamEvent

class MyProvider(LLMProvider):
    async def chat_stream(self, messages: List[Message], tools: List[ChatCompletionToolParam], config: AgentConfig) -> AsyncGenerator[StreamEvent, None]:
        ...

    async def chat(self, messages: List[Message], tools: List[ChatCompletionToolParam], config: AgentConfig) -> ChatResponse:
        ...

agent = Agent(llm_provider=MyProvider())
```

## Error handling

- HTTP errors raise `httpx.HTTPStatusError`; business-failure envelopes raise `RuntimeError`.
- Inside the agent loop, provider/transport errors do not raise — they are surfaced as an `error` `StreamEvent` and end the run. `run_to_completion(...)` re-raises them as `RuntimeError`.
- `result.success` reflects the capability call only. **Do not** treat it as the final billing outcome — confirm charges with `usage(...)` / `ledger(...)`.

## Examples

Runnable examples live under [`packages/python-sdk/examples/`](https://github.com/QVerisAI/qveris-agent-toolkit/tree/main/packages/python-sdk/examples):

| Example | Scenario |
|---------|----------|
| `finance_research.py` | Stock quote / market data research |
| `risk_compliance.py` | Sanctions, adverse media, compliance screening |
| `crypto_market.py` | Crypto price and volume data |
| `data_analysis.py` | Dataset enrichment with external capability data |
| `explainable_routing.py` | Cost-aware capability selection with `why_recommended` / `expected_cost` |
| `budget_guard.py` | Per-session credit budget with `Agent(budget_credits=...)` |
| `agent_loop_integration.py` | LLM agent loop integration |
| `interactive_chat.py` | Interactive streaming terminal chat |
| `stock_debate.py` | Multi-agent stock research debate |
| `langchain_integration.py` | QVeris capabilities as LangChain tools (`qveris[langchain]`) |
| `openai_agents_integration.py` | QVeris capabilities as OpenAI Agents SDK tools (`qveris[openai-agents]`) |
| `crewai_integration.py` | QVeris capabilities as CrewAI tools (`qveris[crewai]`) |
| `autogen_integration.py` | QVeris capabilities as AutoGen tools (`qveris[autogen]`) |
| `llamaindex_integration.py` | QVeris capabilities as LlamaIndex tools (`qveris[llamaindex]`) |
| `pydantic_ai_integration.py` | QVeris capabilities as Pydantic AI tools (`qveris[pydantic-ai]`) |
| `otel_tracing.py` | OpenTelemetry spans for discover/call (`qveris[otel]`) |

Capability examples run `discover`/`inspect` when `QVERIS_API_KEY` is set, and only execute `call` when `RUN_QVERIS_CALLS=1`.

## Compatibility

- Python `>=3.8`.
- Public methods and Pydantic model fields follow additive compatibility where possible.
- Deprecated aliases remain for at least one minor release after a canonical replacement ships.
- Breaking changes require a major version bump and migration notes.

## Links

- Package: [`qveris` on PyPI](https://pypi.org/project/qveris/)
- Source: [`packages/python-sdk`](https://github.com/QVerisAI/qveris-agent-toolkit/tree/main/packages/python-sdk)
- REST API: [rest-api.md](rest-api.md)
- Get an API key: [Dashboard / API Keys](/account?page=api-keys)
