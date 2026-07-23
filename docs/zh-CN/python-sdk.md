# QVeris Python SDK

QVeris Python SDK v0.5.0 是最新测试版本。使用异步客户端，在你自己的智能体和应用中发现、检查、探测、调用并审计 10,000+ 真实已验证的 API 能力。

SDK 提供两种控制粒度：

- **`QverisClient`** —— QVeris REST API 的轻量类型化封装（`discover`、`inspect`、`probe`、`call`、`usage`、`ledger`）。
- **`Agent`** —— 开箱即用的 LLM 工具循环，让模型自主发现并调用能力。

需要完全控制时用 client；想几行代码就跑起来一个可用助手时用 agent。

## 安装

```bash
pip install qveris
```

需要 Python 3.8+。运行时依赖：`httpx`、`pydantic`、`pydantic-settings`、`openai`。

## 身份认证

SDK 从环境变量 `QVERIS_API_KEY` 读取 API 密钥：

```bash
export QVERIS_API_KEY="sk-..."
```

在[控制台/API密钥](/account?page=api-keys)中创建密钥。也可以显式传入配置：

```python
from qveris import QverisClient, QverisConfig

client = QverisClient(QverisConfig(api_key="sk-..."))
```

API 地址优先级为：`QverisConfig(base_url=...)` > `QVERIS_BASE_URL` > `https://qveris.ai/api/v1`。API key 不参与地址选择。覆盖值必须是无凭据、查询串和片段的 HTTP(S) URL。

## 快速开始

核心流程是 **discover（发现）→ inspect（检查）→ call（调用）**，之后可选 **audit（审计）**。所有方法都是 `async`。

```python
import asyncio
from qveris import QverisClient

async def main():
    client = QverisClient()
    try:
        # 1. 用自然语言发现能力（免费）
        discovered = await client.discover("天气预报 API", limit=5)
        tool = discovered.results[0]

        # 2. 检查所选能力，获取完整参数
        inspected = await client.inspect([tool.tool_id], search_id=discovered.search_id)
        selected = inspected.results[0]

        # 3. 在不执行或扣费的情况下校验参数并获取报价
        params = (
            selected.examples.sample_parameters
            if selected.examples and selected.examples.sample_parameters
            else {"city": "北京"}
        )
        probe = await client.probe(selected.tool_id, params, checks=["schema", "quote"])

        # 4. 调用（可能消耗积分）
        result = await client.call(
            selected.tool_id,
            params,
            search_id=discovered.search_id,
            max_response_size=20480,
        )
        print(result.success, result.result)

        # 5. 审计最终扣费结果
        usage = await client.usage(execution_id=result.execution_id, summary=True)
        ledger = await client.ledger(summary=True, limit=5)
        print(usage.total, ledger.total)
    finally:
        await client.close()

asyncio.run(main())
```

> `QverisClient` 持有一个 HTTP 连接池。用完务必 `await client.close()`（建议放在 `finally` 中）。

## Agent（智能体）

`Agent` 把同一套流程封装成一个 LLM 工具循环。模型会拿到 `discover`、`inspect`、`call` 三个工具并自行决定何时调用。

默认 agent 使用 OpenAI 兼容的 provider，因此需要设置：

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://api.openai.com/v1"   # 可选；用于 OpenAI 兼容 provider
```

### 流式

```python
import asyncio
from qveris import Agent, Message

async def main():
    async with Agent() as agent:
        messages = [Message(role="user", content="查一下纽约现在的天气。")]
        async for event in agent.run(messages):
            if event.type == "content" and event.content:
                print(event.content, end="", flush=True)

asyncio.run(main())
```

`Agent` 是异步上下文管理器 —— `async with Agent() as agent:` 会自动释放网络资源。

### 仅要最终文本

只需要最终回答时：

```python
async with Agent() as agent:
    answer = await agent.run_to_completion(
        [Message(role="user", content="找一个股票报价能力并查询 AAPL。")]
    )
    print(answer)
```

### 事件类型

`Agent.run(messages)` 产出 `StreamEvent` 对象。通过 `event.type` 区分：

| `type` | 含义 |
|--------|------|
| `content` | 助手文本（流式时为增量分片，否则为完整消息） |
| `reasoning` / `reasoning_details` | 部分 provider 的推理 token / 结构化推理 |
| `tool_call` | 模型正在调用 `discover` / `inspect` / `call`（或你的额外工具） |
| `tool_result` | 工具调用的执行结果（`event.tool_result` 含 `name`、`result`、`is_error`） |
| `metrics` | provider 上报的 token 用量 / 耗时 |
| `error` | 终止本次运行的致命错误 |
| `budget_warning` / `budget_exceeded` | 会话消耗越过预警阈值 / 某次调用因超预算被拦截（见 [预算护栏](#预算护栏)） |

给 `run(...)` 传 `stream=False` 可改为接收完整助手轮次而非增量分片。

### 预算护栏

设置会话级积分预算以约束自主消耗：

```python
agent = Agent(budget_credits=25)
```

设置后，agent 会从 `discover` / `inspect` 学习每个能力的 `expected_cost`，并在**请求发出之前拦截预计会超预算的 `call`**——同时发出 `budget_exceeded` 事件，让模型改选更便宜的能力或停止。它从 `call` 的账单累计实际消耗，并在接近上限时发出一次 `budget_warning`。可随时查询状态：

```python
status = agent.budget_status()   # {"limit": 25, "spent": 12.0, "remaining": 13.0}，或 None
```

`spent` 反映预结算金额——请用 `usage(...)` / `ledger(...)` 核对最终扣费。成本未知的能力不会被拦截（无法估算）。未设置 `budget_credits` 时，agent 行为完全不变。

## 配置参考

### `QverisConfig`

| 字段 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| `api_key` | `QVERIS_API_KEY` | `None` | API 密钥，以 `Authorization: Bearer ...` 发送 |
| `base_url` | `QVERIS_BASE_URL` | `https://qveris.ai/api/v1` | API 基础地址 |
| `enable_history_pruning` | — | `True` | 裁剪/压缩旧的工具输出以节省 token（agent 循环） |
| `max_iterations` | — | `50` | agent 工具循环的最大迭代次数 |

### `AgentConfig`

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `model` | `gpt-4o` | 传给当前 LLM provider 的模型名 |
| `additional_system_prompt` | `None` | 追加到默认工具使用系统提示词之后 |
| `temperature` | `0.7` | 在 provider 支持时透传 |

```python
from qveris import Agent, QverisConfig, AgentConfig

agent = Agent(
    config=QverisConfig(max_iterations=20),
    agent_config=AgentConfig(model="gpt-4o", temperature=0.2),
)
```

## API 参考

[根据源码生成的 API 参考](python-sdk-api.md)列出当前公开 client、Agent、配置和响应模型的签名。
Sphinx 会根据 Python 对象与 docstring 重新生成该页面，CI 同时检查是否漂移。

### `QverisClient`

| 方法 | REST 端点 | 用途 |
|------|-----------|------|
| `discover(query, limit=20, session_id=None, view=None, lang=None)` | `POST /search` | 发现能力；`view="routing"` 返回精简 routing card（免费） |
| `inspect(tool_ids, search_id=None, session_id=None)` | `POST /tools/by-ids` | 获取能力完整元数据（免费） |
| `call(tool_id, parameters, search_id=None, session_id=None, max_response_size=None, respond_with=None)` | `POST /tools/execute` | 执行能力；可选择完整、摘要或 JSONPath 字段 |

投影参数仅在显式指定时发送。旧服务返回 `422 extra_forbidden` 时仅移除对应可选字段并重试一次；无效投影仍按错误返回。
| `usage(**filters)` | `GET /auth/usage/history/v2` | 审计请求状态与扣费结果 |
| `ledger(**filters)` | `GET /auth/credits/ledger` | 查看最终积分余额变动 |
| `handle_tool_call(func_name, func_args, session_id=None)` | — | 把 LLM 工具调用桥接到对应的 QVeris 方法 |
| `close()` | — | 关闭底层 HTTP 客户端 |

`tool_ids` 接受单个字符串或可迭代对象。`usage(...)` 和 `ledger(...)` 接受仅关键字过滤参数，如 `start_date`、`end_date`、`summary`（默认 `True`）、`bucket`、`charge_outcome`、`execution_id`、`search_id`、`direction`、`entry_type`、`min_credits`、`max_credits`、`limit`、`page`、`page_size`。

仍保留向后兼容别名：`search_tools` → `discover`，`get_tools_by_ids` → `inspect`，`execute_tool` → `call`。

### `Agent`

| 成员 | 说明 |
|------|------|
| `run(messages, stream=True)` | 产出 `StreamEvent` 的异步生成器；主集成 API |
| `run_to_completion(messages)` | 非流式；返回最终助手文本 |
| `get_last_messages()` | 上一次 `run(...)` 的对话历史，含工具调用/结果 |
| `new_session()` | 重置关联/会话 id |
| `close()` | 释放网络资源（或用 `async with`） |

构造函数：`Agent(config=None, agent_config=None, llm_provider=None, extra_tools=None, extra_tool_handler=None, debug_callback=None)`。

## 类型化模型

SDK 返回 Pydantic v2 模型，因此你能获得自动补全与校验。未知的后端字段会被保留，因此较新的 API 元数据不会破坏较旧的 SDK 客户端。

- 发现 / 检查：`SearchResponse` → `results: list[ToolInfo]`；`ToolInfo` 含 `tool_id`、`name`、`description`、`params: list[ToolParameter]`、`examples`、`stats`、`billing_rule`。
- 调用：`ToolExecutionResponse`，含 `execution_id`、`success`、`result`、`error_message`、`billing`（`CompactBillingStatement`）、`cost`、`remaining_credits`。
- 调用审计：`UsageHistoryResponse` → `items: list[UsageEventItem]`、`total`、`summary`。
- 积分账本：`CreditsLedgerResponse` → `items: list[CreditsLedgerItem]`、`total`、`summary`。

```python
from qveris import ToolExecutionResponse

def explain(result: ToolExecutionResponse) -> str:
    if not result.success:
        return f"失败：{result.error_message}"
    charged = result.billing.summary if result.billing else "无计费信息"
    return f"成功（{charged}）；剩余={result.remaining_credits}"
```

## 集成方式

按你的应用选择合适的粒度：

- **直接使用类型化 client** —— 在自己的代码里调用 `discover`/`inspect`/`call`/`usage`/`ledger`。
- **内置流式 agent** —— `Agent.run(messages)` 并消费 `StreamEvent`。
- **内置非流式 agent** —— `Agent.run(messages, stream=False)`，获取完整轮次与事件。
- **仅要最终文本** —— `Agent.run_to_completion(messages)`。
- **自带循环** —— 把 QVeris 工具 schema 暴露给你自己的 LLM provider，再把工具调用路由回 client：

```python
from qveris import QverisClient
from qveris.client.tools import DISCOVER_TOOL_DEF, INSPECT_TOOL_DEF, CALL_TOOL_DEF

tools = [DISCOVER_TOOL_DEF, INSPECT_TOOL_DEF, CALL_TOOL_DEF]
client = QverisClient()

# ... 你的 LLM 产出一个工具调用 (func_name, func_args) ...
result, is_error, handled = await client.handle_tool_call(func_name, func_args)
if handled and not is_error:
    ...  # 把 result 回传给模型
```

### 框架集成

把 QVeris 的 discover/inspect/call 工作流暴露为主流 Agent 框架的原生工具。适配器惰性导入各自框架，因此基础 `qveris` 包不依赖它们。

| 框架 | 原生工具类型 | Adapter 安装 | 完整 Agent 还需要 |
|------|--------------|--------------|-------------------|
| LangChain / LangGraph | `StructuredTool` | `pip install "qveris[langchain]"`（Adapter 支持 Python 3.9+） | 下方当前版 `create_agent` 示例需要 Python 3.10+、`langchain>=1.0` 和模型 provider 包。 |
| OpenAI Agents SDK | `FunctionTool` | `pip install "qveris[openai-agents]"`（Python 3.10+） | 将工具传给 `Agent`，最后 `await client.close()`。 |
| CrewAI | `BaseTool` | `pip install "qveris[crewai]"`（Python 3.10+） | Adapter 负责同步/异步桥接，最后调用 `aclose(client)`。 |
| AutoGen | `autogen_core.tools.FunctionTool` | `pip install "qveris[autogen]"`（Python 3.10+） | 另装 `autogen-agentchat` 和模型扩展，如 `autogen-ext[openai]`。 |
| LlamaIndex | `llama_index.core.tools.FunctionTool` | `pip install "qveris[llamaindex]"`（Python 3.10+） | 另装 `FunctionAgent` 使用的模型集成包；使用异步 Agent 或 `await tool.acall(...)`。 |
| Pydantic AI | `pydantic_ai.Tool` | `pip install "qveris[pydantic-ai]"`（Python 3.10+） | Extra 为精简安装；另装模型 provider extra，如 `pydantic-ai-slim[openai]`。 |

每次调用 `get_qveris_tools(client, session_id=...)` 都会按顺序返回 `qveris_discover`、`qveris_inspect`、`qveris_call` 三个工具。工具结果（包括 QVeris 错误结果）统一为 JSON 字符串，Agent 可以读取并自行调整参数或改选能力。`discover` 免费并返回 `search_id`，后续应把它传给 `inspect` 和 `call`。完整 Agent 运行既需要 `QVERIS_API_KEY`，也需要所选模型 provider 的 API key。

**LangChain 与 LangGraph**

使用 LangChain 当前的 `create_agent` API。它运行在 LangGraph 上；自定义 LangGraph 工作流也可以把同一组工具放入 `ToolNode`。

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
        result = await agent.ainvoke({"messages": [{"role": "user", "content": "查找股票报价工具并查询 AAPL。"}]})
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
        result = await Runner.run(agent, "查找股票报价能力并查询 AAPL。")
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
agent = Agent(role="Researcher", goal="选择正确能力", backstory="工具专家", tools=get_qveris_tools(client))
# Crew(...).kickoff()
aclose(client)
```

CrewAI 的 client 连接运行在 Adapter 的专用事件循环中，因此要使用 `aclose(client)`，不能使用 `await client.close()`。

**AutoGen、LlamaIndex 与 Pydantic AI**

```python
# 以下片段假设已配置 QverisClient 以及框架所需的 model_client / llm；
# 只需选择与你的 Agent 框架对应的 Adapter。
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

完整的 provider 配置与资源关闭方式见下方可运行示例。TypeScript SDK 提供 Vercel AI SDK 适配器。

### 自定义 LLM provider

默认 `Agent()` 使用内置的 OpenAI 兼容 provider。如需对接其他模型 API，实现 `LLMProvider` 并传入：

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

## 错误处理

- HTTP 错误抛出 `httpx.HTTPStatusError`；业务失败信封抛出 `RuntimeError`。
- 在 agent 循环内部，provider/传输错误不会抛出 —— 它们以 `error` 类型的 `StreamEvent` 暴露并结束本次运行。`run_to_completion(...)` 会将其重新抛为 `RuntimeError`。
- `result.success` 只反映能力调用本身。**不要**把它当作最终扣费结论 —— 用 `usage(...)` / `ledger(...)` 确认扣费。

## 示例

可运行示例位于 [`packages/python-sdk/examples/`](https://github.com/QVerisAI/qveris-agent-toolkit/tree/main/packages/python-sdk/examples)：

| 示例 | 场景 |
|------|------|
| `finance_research.py` | 股票报价 / 市场数据研究 |
| `risk_compliance.py` | 制裁、负面舆情、合规筛查 |
| `crypto_market.py` | 加密货币价格与成交量数据 |
| `data_analysis.py` | 用外部能力数据丰富数据集 |
| `explainable_routing.py` | 基于 `why_recommended` / `expected_cost` 的成本感知能力选型 |
| `budget_guard.py` | 用 `Agent(budget_credits=...)` 设置会话级积分预算 |
| `agent_loop_integration.py` | LLM agent 循环集成 |
| `interactive_chat.py` | 交互式流式终端聊天 |
| `stock_debate.py` | 多 Agent 股票研究辩论 |
| `langchain_integration.py` | 把 QVeris 能力作为 LangChain 工具（`qveris[langchain]`） |
| `openai_agents_integration.py` | 把 QVeris 能力作为 OpenAI Agents SDK 工具（`qveris[openai-agents]`） |
| `crewai_integration.py` | 把 QVeris 能力作为 CrewAI 工具（`qveris[crewai]`） |
| `autogen_integration.py` | 把 QVeris 能力作为 AutoGen 工具（`qveris[autogen]`） |
| `llamaindex_integration.py` | 把 QVeris 能力作为 LlamaIndex 工具（`qveris[llamaindex]`） |
| `pydantic_ai_integration.py` | 把 QVeris 能力作为 Pydantic AI 工具（`qveris[pydantic-ai]`） |
| `otel_tracing.py` | 为 discover/call 生成 OpenTelemetry span（`qveris[otel]`） |

设置 `QVERIS_API_KEY` 后，能力示例会运行 `discover`/`inspect`；仅当设置 `RUN_QVERIS_CALLS=1` 时才执行 `call`。

## 兼容性

- Python `>=3.8`。
- 公开方法与 Pydantic 模型字段尽量遵循增量兼容。
- 规范方法替代上线后，弃用别名至少保留一个小版本。
- 破坏性变更需要主版本号升级并附迁移说明。

## 链接

- 包：[PyPI 上的 `qveris`](https://pypi.org/project/qveris/)
- 源码：[`packages/python-sdk`](https://github.com/QVerisAI/qveris-agent-toolkit/tree/main/packages/python-sdk)
- REST API：[rest-api.md](rest-api.md)
- 获取 API 密钥：[控制台/API密钥](/account?page=api-keys)
