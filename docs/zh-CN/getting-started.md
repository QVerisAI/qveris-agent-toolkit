# QVeris 文档

## 什么是 QVeris

**QVeris** 是**面向智能体的能力路由网络**。它让你的 Agent 能够：

- **发现（Discover）** 能力（API、数据源、自动化任务），使用自然语言描述需求 — 免费
- **检查（Inspect）** 候选能力，比较参数、成功率、延迟和价格
- **调用（Call）** 任意能力，传入结构化参数，获取结构化结果

QVeris 在 Agent 循环中表现出色（发现 → 检查 → 调用 → 将结果反馈给模型），支持多种集成方式。

**费用：** 发现（Discover）免费。调用（Call）每次消耗 1–100 积分，按数据和任务价值计费。免费套餐含 1,000 积分。详情见 [qveris.ai/pricing](https://qveris.ai/pricing)。

---

## 快速开始

QVeris 提供三种使用方式。

### 通过 MCP 使用 QVeris

如果你的客户端支持 **Model Context Protocol (MCP)**，可以添加官方 QVeris MCP 服务器，立即获得：

- `search_tools`（发现）
- `get_tools_by_ids`（检查）
- `execute_tool`（调用）

完整 MCP 参考文档见 [MCP 服务器文档](mcp-server.md)。

**配置方式（Cursor / 任意 MCP 客户端）**

```json
{
  "mcpServers": {
    "qveris": {
      "command": "npx",
      "args": ["-y", "@qverisai/mcp"],
      "env": {
        "QVERIS_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**试一试**

> "发现一个天气能力，获取东京的实时天气"

助手会：

- 调用 `search_tools` 发现匹配的能力（如"天气"）
- 可选调用 `get_tools_by_ids` 检查最佳候选
- 使用能力 ID 和参数调用 `execute_tool`

---

### 使用 QVeris Python SDK

从 [GitHub](https://github.com/QVerisAI/sdk-python) 获取并安装：

```bash
pip install qveris
```

设置环境变量：

- `QVERIS_API_KEY`（从 [QVeris](https://qveris.ai) 获取）
- `OPENAI_API_KEY`（或你的 OpenAI 兼容服务商密钥）
- `OPENAI_BASE_URL`（可选；用于 OpenAI 兼容服务商）

最小流式示例：

```python
import asyncio
from qveris import Agent, Message

async def main():
    agent = Agent()
    messages = [Message(role="user", content="发现一个天气能力，查询纽约的实时天气。")]
    async for event in agent.run(messages):
        if event.type == "content" and event.content:
            print(event.content, end="", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
```

---

### 直接调用 QVeris REST API

**Base URL**

`https://qveris.ai/api/v1`

**身份认证**

在 `Authorization` 请求头中携带 API 密钥：

```text
Authorization: Bearer YOUR_API_KEY
```

#### 1）发现能力

`POST /search`

**cURL**

```bash
curl -sS -X POST "https://qveris.ai/api/v1/search" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"weather forecast API\",\"limit\":10}"
```

响应包含 `search_id` 和能力列表（每项含 `tool_id`、参数 schema、示例等）。

**Python**

```python
import os
import requests

API_KEY = os.environ["QVERIS_API_KEY"]

resp = requests.post(
    "https://qveris.ai/api/v1/search",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={"query": "weather forecast API", "limit": 10},
    timeout=30,
)
resp.raise_for_status()
data = resp.json()
print(data["search_id"])
print(data["results"][0]["tool_id"] if data.get("results") else None)
```

**TypeScript**

```typescript
const apiKey = process.env.QVERIS_API_KEY!;

const resp = await fetch("https://qveris.ai/api/v1/search", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: "weather forecast API", limit: 10 }),
});

if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
const data = await resp.json();
console.log(data.search_id);
console.log(data.results?.[0]?.tool_id);
```

#### 2）检查能力

`POST /tools/by-ids`

调用之前，可以检查一个或多个能力，查看完整详情（参数、成功率、延迟等）。

**cURL**

```bash
curl -sS -X POST "https://qveris.ai/api/v1/tools/by-ids" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"tool_ids\":[\"openweathermap.weather.execute.v1\"],\"search_id\":\"YOUR_SEARCH_ID\"}"
```

**Python**

```python
resp = requests.post(
    "https://qveris.ai/api/v1/tools/by-ids",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "tool_ids": ["openweathermap.weather.execute.v1"],
        "search_id": "YOUR_SEARCH_ID",
    },
    timeout=30,
)
resp.raise_for_status()
print(resp.json())
```

**TypeScript**

```typescript
const resp = await fetch("https://qveris.ai/api/v1/tools/by-ids", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    tool_ids: ["openweathermap.weather.execute.v1"],
    search_id: "YOUR_SEARCH_ID",
  }),
});

if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
const data = await resp.json();
console.log(data.results);
```

返回与 `/search` 相同的 schema — 包含完整能力详情、参数、示例和统计数据。

#### 3）调用能力

`POST /tools/execute?tool_id={tool_id}`

**cURL**（调用发现阶段返回的能力）

```bash
curl -sS -X POST "https://qveris.ai/api/v1/tools/execute?tool_id=openweathermap.weather.execute.v1" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"search_id\":\"YOUR_SEARCH_ID\",\"parameters\":{\"city\":\"London\",\"units\":\"metric\"},\"max_response_size\":20480}"
```

若输出超过 `max_response_size`，响应会包含 `truncated_content` 和临时的 `full_content_file_url`。

**Python**

```python
import os
import requests

API_KEY = os.environ["QVERIS_API_KEY"]

tool_id = "openweathermap.weather.execute.v1"  # 来自发现结果
search_id = "YOUR_SEARCH_ID"  # 来自 /search 响应

resp = requests.post(
    f"https://qveris.ai/api/v1/tools/execute?tool_id={tool_id}",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "search_id": search_id,
        "parameters": {"city": "London", "units": "metric"},
        "max_response_size": 20480,
    },
    timeout=60,
)
resp.raise_for_status()
print(resp.json())
```

**TypeScript**

```typescript
const apiKey = process.env.QVERIS_API_KEY!;

const toolId = "openweathermap.weather.execute.v1"; // 来自发现结果
const searchId = "YOUR_SEARCH_ID"; // 来自 /search 响应

const resp = await fetch(
  `https://qveris.ai/api/v1/tools/execute?tool_id=${encodeURIComponent(toolId)}`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      search_id: searchId,
      parameters: { city: "London", units: "metric" },
      max_response_size: 20480,
    }),
  }
);

if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
const data = await resp.json();
console.log(data);
```

---

### 如何获取 API 密钥

1. 访问 [QVeris](https://qveris.ai)
2. 登录 / 注册账号（免费，注册赠送 1,000 积分）
3. 创建 API 密钥
4. 使用方式：
   - `QVERIS_API_KEY` 环境变量（MCP / Python SDK），或
   - `Authorization: Bearer ...` 请求头（REST API）

---

### 推荐系统提示词

在启用 QVeris 工具时，将以下内容复制粘贴到助手的系统提示词中：

```text
你是一个有用的助手，可以动态发现并调用各种能力来帮助用户。首先思考完成用户任务可能需要哪类能力。然后使用 search_tools 工具，以描述能力的查询词进行搜索，而非直接写出你稍后要传入的具体参数。再使用 execute_tool 工具调用合适的能力，通过 params_to_tool 传入参数。如果能力具有 success_rate 和 avg_execution_time，请在选择时加以参考。你可以参考每个能力提供的示例。你可以在一次响应中发起多个工具调用。
```

---

### 开放生态

QVeris 的核心引擎是托管服务。所有客户端工具（MCP 服务器、SDK、技能、插件）均为开源：

- **GitHub 组织**：[github.com/orgs/QVerisAI/repositories](https://github.com/orgs/QVerisAI/repositories)
- **ClawHub 技能**：[clawhub.ai/skills?q=qveris](https://clawhub.ai/skills?sort=downloads&q=qveris)
- **npm 包**：[@qverisai](https://www.npmjs.com/org/qverisai)
- **上游贡献**：[openclaw/openclaw](https://github.com/openclaw/openclaw)、[openclaw/clawhub](https://github.com/openclaw/clawhub)
