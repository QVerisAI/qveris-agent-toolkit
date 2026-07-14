# QVeris Python SDK

异步 Python SDK，让你在自己的智能体和应用中发现、检查、调用并审计 10,000+ 真实已验证的 API 能力。

SDK 提供两种控制粒度：

- **`QverisClient`** —— QVeris REST API 的轻量类型化封装（`discover`、`inspect`、`call`、`usage`、`ledger`）。
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

在 [qveris.ai](https://qveris.ai) 获取密钥。也可以显式传入配置：

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

        # 3. 调用（可能消耗积分）
        params = (
            selected.examples.sample_parameters
            if selected.examples and selected.examples.sample_parameters
            else {"city": "北京"}
        )
        result = await client.call(
            selected.tool_id,
            params,
            search_id=discovered.search_id,
            max_response_size=20480,
        )
        print(result.success, result.result)

        # 4. 审计最终扣费结果
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

### `QverisClient`

| 方法 | REST 端点 | 用途 |
|------|-----------|------|
| `discover(query, limit=20, session_id=None)` | `POST /search` | 用自然语言发现能力（免费） |
| `inspect(tool_ids, search_id=None, session_id=None)` | `POST /tools/by-ids` | 获取能力完整元数据（免费） |
| `call(tool_id, parameters, search_id=None, session_id=None, max_response_size=None)` | `POST /tools/execute` | 执行能力（可能消耗积分） |
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

把 QVeris 的 discover/inspect/call 工作流暴露为主流 Agent 框架的工具。适配器惰性导入各自框架，因此基础 `qveris` 包不依赖它们。

**LangChain**

```bash
pip install qveris[langchain]
```

```python
from qveris import QverisClient
from qveris.integrations.langchain import get_qveris_tools

client = QverisClient()
tools = get_qveris_tools(client)  # 3 个异步工具：qveris_discover / qveris_inspect / qveris_call
# 把 `tools` 绑定到 LangChain 或 LangGraph agent，用完 `await client.close()`
```

工具是异步的（用 `ainvoke` / 异步 agent executor）。

**OpenAI Agents SDK**

```bash
pip install qveris[openai-agents]
```

```python
from agents import Agent, Runner
from qveris import QverisClient
from qveris.integrations.openai_agents import get_qveris_tools

client = QverisClient()
agent = Agent(name="Assistant", tools=get_qveris_tools(client))
result = await Runner.run(agent, "Find a stock quote capability and quote AAPL.")
await client.close()
```

**CrewAI**

```bash
pip install qveris[crewai]
```

```python
from crewai import Agent
from qveris import QverisClient
from qveris.integrations.crewai import get_qveris_tools, aclose

client = QverisClient()
agent = Agent(role="Researcher", goal="...", backstory="...", tools=get_qveris_tools(client))
# 同步运行你的 crew（crew.kickoff()），然后：
aclose(client)
```

CrewAI 同步执行工具；适配器在一个专用事件循环上桥接到异步 client。由于 client 的连接绑定在该循环上，请用 `aclose(client)` 关闭（而非 `await client.close()`）。TypeScript SDK 提供 Vercel AI SDK 适配器。

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
| `langchain_integration.py` | 把 QVeris 能力作为 LangChain 工具（`qveris[langchain]`） |
| `openai_agents_integration.py` | 把 QVeris 能力作为 OpenAI Agents SDK 工具（`qveris[openai-agents]`） |
| `crewai_integration.py` | 把 QVeris 能力作为 CrewAI 工具（`qveris[crewai]`） |

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
- 获取 API 密钥：[qveris.ai](https://qveris.ai)
