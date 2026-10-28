# QVeris 文档

## 什么是 QVeris

**QVeris** 是一个**专业数据与工具访问平台**。它帮助你的智能体：

- **发现（Discover）** 能力（API、数据源、自动化任务），使用自然语言描述需求 — 免费
- **检查（Inspect）** 候选能力，比较参数、成功率、延迟和价格
- **调用（Call）** 任意能力，传入结构化参数，获取结构化结果

QVeris 支持多种集成方式。默认路径是发现 → 调用；仅当选择服务或构造请求需要更完整、更新的契约信息时再使用检查，仅当需要预检校验或当前报价时再使用 Probe。

进行 Provider 比较时，如果需要确认当前范围或完整契约，必须逐一 Inspect；Discover 摘要不等于确认。比较需要当前报价时，必须逐一 Probe。复用只能保留精确路由，不能保留业务参数或结果：参数必须来自当前请求；当前、最新、今天或其他时效性数据必须执行新的 Call。

**费用：** 发现（Discover）免费。调用（Call）按能力的计费规则定价，最终结算结果可在调用历史和积分账本中查看。注册验证后可一次性获得 1,000 体验积分。详情见[定价页面](/pricing)。

---

## 选择认证方式

- **浏览器试用：**在工具页面的工作台点击**浏览器试用**；页面显示试用控件时，明确开始试用，检查工具、真实输入和报价后再确认一次 Call。浏览器不会收到 API 密钥。恢复与认领说明见[认证与试用指南](/auth.md)。

- **OAuth：**使用 `qveris auth login`，或在支持 OAuth 自动发现的客户端中添加托管 MCP 端点，按提示完成浏览器授权，无需复制 API 密钥。
- **已有 API 密钥：**继续使用现有密钥。通过私密环境变量 `QVERIS_API_KEY` 为 REST、SDK、CLI 提供凭据，或运行 `qveris login` 进行掩码输入。该命令需要密钥，与 `qveris auth login` 不同。
- **公开只读 REST：**在独立的无凭据 REST 客户端中显式设置 `X-Qveris-Access-Mode: public-readonly`，仅用于 Discover/Inspect，不创建试用或积分，也不能授权 Call。不得混用 Authorization 或 cookie；浏览器 HTTP 使用 `credentials: "omit"`。错误密钥不会降级为公开访问。限制、401/429 处理及认证升级见 [REST 指南](/docs/rest-api)。CLI／SDK 公开读取请使用下方指南列出的支持版本。
- **尚无凭据的 Agent：**显式调用已有 Agent API 注册匿名试用。注册会签发凭据，不代表 Discover 或 Call 可以免鉴权。一次性秘密、限制、期限与当前认领约束见[认证与试用生命周期](/auth.md)。

Discover 免费；默认 CLI／SDK 和认证 MCP 接入仍需认证。不要把密钥或认领码放入提示词、URL、共享配置、日志或代码仓库。

## 接入模式与认证升级

| 客户端或入口 | 公开只读接入 | 继续 Call |
| --- | --- | --- |
| REST | 显式 public-readonly 请求头，仅 Discover/Inspect，不携带凭据或 cookie。 | 完成认证；Inspect 已选工具，重新核对权限与必要报价。 |
| 托管 MCP | 使用 [MCP 指南](/docs/mcp-server)中的独立只读端点，仅 discover/inspect，不分配会话。 | 明确使用默认 OAuth 或有效密钥连接。 |
| 本地 MCP 0.15.0 | 无密钥时可列出工具 schema，不代表 Discover/Inspect 请求成功。 | 按 [MCP 指南](/docs/mcp-server)配置有效密钥。 |
| 已发布 CLI 0.12.0 | 在独立无凭据配置中显式使用 `--public-read-only` Discover/Inspect，见 [CLI 指南](/docs/cli)。 | 明确使用 OAuth 或 API 密钥，再认证 Inspect 已选工具。 |
| 已发布 QVeris SDK：TypeScript 0.10.0／Python 0.9.0 | 独立使用 `Qveris.publicReadOnly()` 或 `PublicDiscoveryClient`，见 [TypeScript 指南](/docs/js-sdk)和 [Python 指南](/docs/python-sdk)。 | 创建新的认证客户端，Inspect 时不携带旧公开上下文。 |

错误密钥不会降级为公开访问；公开连接不得混用凭据或 cookie。遇到 401，应为目标操作完成认证；遇到 429，遵循 Retry-After 与有界重试指引，不得创建身份或轮换凭据绕过限制。确切限制与错误见 [REST 指南](/docs/rest-api)。

公开接入不创建账号、密钥、试用积分或供应商执行。升级时保留已选工具与输入意图，但不要把公开 search_id 带入认证 Inspect；使用其新的认证结果与必要报价，再明确确认成本。已经选定工具时，不要求仅为升级认证而额外自然语言 Discover。

## 浏览器结果、恢复与认领

工具返回结果后仍可能等待结算。超时或响应丢失时，通过页面恢复原操作；停止等待不等于撤销执行。不要自动重放 Call 或另建试用。报价不锁价，页面显示的容忍范围也不是额外赠送积分。

浏览器认领控件可用时，可以验证邮箱创建账号，或续接接收试用的已有账号，必要时登录。认领保留原赠送剩余额度与期限，撤销旧试用密钥，并要求明确续接正式身份。正式账号可用积分会自动抵扣已确认欠费；积分不足时保留剩余欠费，不阻止认领。pending／unknown 执行需先核对。查看回执中的已抵扣与账号剩余欠费，再刷新身份与权限。旧 discovery context 需重新 Discover；已选定具体工具时，重新核对输入、权限和报价即可。已有有效正式账号会话可直接续接，仅在需要时登录。Agent API 方式使用独立凭据与认领规则。

在账户中打开[已保存试用](/account?page=saved-trials)，查看回执和原试用的执行／搜索历史摘要，每页最多 10 条。使用经过验证的接收账号即可，无需试用 cookie 或本地认领恢复记录。原历史独立保留，不会自动并入普通用量列表；不展示原始供应商响应正文。

Call 结果未知时，保留原始执行 ID 和可用的幂等键，先通过[执行结果查询](/docs/api-reference/reconcile-call)核对结果，再考虑是否需要再次调用；超时或未找到记录并不能证明原调用未执行。

## 快速开始

QVeris 提供多种使用方式，选择最适合你的即可。

### 使用 QVeris CLI

在终端中直接发现、检查和调用能力。

**安装**

```bash
npm install -g @qverisai/cli
qveris auth login
qveris discover "天气预报 API" --json
```

也可通过 npm 安装（`npm install -g @qverisai/cli`）或免安装运行（`npx @qverisai/cli`）。

**首次成功：仅 Discover**

使用 OAuth，无需复制密钥；如果已经配置 QVERIS_API_KEY，可跳过 OAuth 登录。

```bash
qveris auth login
qveris discover "天气预报 API" --json
```

CLI 还支持交互模式（`qveris interactive`）、代码生成（`--codegen curl|python|js`）和 Shell 自动补全。完整参考见 [CLI 文档](cli.md)。

如果安装页提供复制的 v1 服务/任务上下文，请保存该 JSON，不要加入参数或密钥，然后使用 CLI 的权威消费入口：

```bash
qveris call --context @context.json --params @params.json
```

模板只是公开 ID 选择提示。CLI 会拒绝敏感或可执行内容，把普通未来字段作为结构化 warning 忽略，并自动刷新已过期的可用性/价格/权限快照。只有当前 Discover 结果和执行策略确实需要时才 Inspect 或 Probe；service-only context 只返回候选，不猜工具。合同与恢复步骤见[复制的服务/任务上下文](cli.md#复制的服务任务上下文)。

---

### 通过 MCP 使用 QVeris

如果你的客户端支持 **Model Context Protocol (MCP)** 和远程 Streamable HTTP，应优先使用托管 MCP。它无需本地软件包或 Node.js 进程，立即获得：

- `discover`（发现）
- `inspect`（检查）
- `call`（调用）

完整 MCP 参考文档见 [MCP 服务器文档](mcp-server.md) 或[托管 MCP 指南](/hosted-mcp)。

#### 托管 MCP 配置（首选）

支持 OAuth 自动发现的客户端可添加下方 URL，按提示完成浏览器授权；不支持 OAuth 时，使用 [MCP 指南](/docs/mcp-server)中的有效密钥备用方案。

```json
{
  "mcpServers": {
    "qveris": {
      "type": "http",
      "url": "https://mcp.qveris.ai/mcp"
    }
  }
}
```

#### 本地 stdio 备用方案（仅适用于不支持远程 HTTP 的客户端）

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

- 调用 `discover` 发现匹配的能力（如"天气"）
- 可选调用 `inspect` 检查合适的候选服务
- 使用能力 ID 和参数调用 `call`

---

### 使用 QVeris Python SDK

Python SDK 现在位于本单体仓库的 [`packages/python-sdk`](../../packages/python-sdk)。安装已发布的包：

```bash
pip install qveris
```

完整指南（client、agent、类型化模型、集成方式）见 [Python SDK](python-sdk.md)。

设置环境变量：

- `QVERIS_API_KEY`（在[控制台/API密钥](/account?page=api-keys)中创建）

Typed client 工作流：

先仅使用 QVeris 凭据完成一次 Discover：

```python
import asyncio
from qveris import QverisClient, QverisConfig

async def main():
    client = QverisClient(QverisConfig(base_url="https://qveris.ai/api/v1"))
    try:
        discovered = await client.discover("天气预报 API", limit=5)
        print(discovered.search_id)
        for candidate in discovered.results:
            print(candidate.tool_id)
    finally:
        await client.close()

asyncio.run(main())
```

以下是可选 Call 示例；运行前请核对真实输入、权限与成本。

```python
import asyncio
import math
from qveris import QverisClient

def matches_type(kind, value):
    return {
        "string": lambda: isinstance(value, str),
        "integer": lambda: isinstance(value, int) and not isinstance(value, bool),
        "number": lambda: isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value),
        "boolean": lambda: isinstance(value, bool),
        "array": lambda: isinstance(value, list),
        "object": lambda: isinstance(value, dict),
    }.get(kind, lambda: False)()

def supports_request(candidate, params):
    if candidate.params is None:
        return False
    definitions = {p.name: p for p in candidate.params}
    if len(definitions) != len(candidate.params):
        return False
    return all(not p.required or p.name in params for p in candidate.params) and all(
        (p := definitions.get(name)) is not None and matches_type(p.type, value)
        and (p.enum is None or any(allowed == value and
             isinstance(allowed, bool) == isinstance(value, bool) for allowed in p.enum))
        for name, value in params.items()
    )

async def main():
    client = QverisClient()
    try:
        discovered = await client.discover("weather forecast API", limit=5)
        params = {"city": "北京"}
        selected = next(
            (
                candidate
                for candidate in discovered.results
                if supports_request(candidate, params)
            ),
            None,
        )
        if selected is None:
            inspected = await client.inspect(
                [candidate.tool_id for candidate in discovered.results[:3]],
                search_id=discovered.search_id,
            )
            selected = next(
                (
                    candidate
                    for candidate in inspected.results
                    if supports_request(candidate, params)
                ),
                None,
            )
        if selected is None:
            raise RuntimeError("没有候选能力提供兼容的当前参数契约")
        result = await client.call(
            selected.tool_id,
            params,
            search_id=discovered.search_id,
        )
        print(result.execution_id, result.success, result.billing)
    finally:
        await client.close()

asyncio.run(main())
```

可选的模型驱动流程；仅此示例需要另外配置模型服务：

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

### 使用 QVeris TypeScript SDK

TypeScript/JavaScript SDK 位于本单体仓库的 [`packages/js-sdk`](../../packages/js-sdk)。安装已发布的包：

```bash
npm install @qverisai/sdk
```

这是一个零依赖的类型化客户端（原生 `fetch`，Node.js 18+）。完整指南（配置、API 参考、类型化响应、错误处理）见 [TypeScript SDK](js-sdk.md)。

先仅使用 QVeris 凭据完成一次 Discover：

```typescript
import { Qveris } from "@qverisai/sdk";

const qveris = Qveris.fromEnv({ baseUrl: "https://qveris.ai/api/v1" });
const discovered = await qveris.discover("天气预报 API", { limit: 5 });
console.log(discovered.search_id, discovered.results.map(tool => tool.tool_id));
```

以下是可选 Call 示例；运行前请核对真实输入、权限与成本。

```typescript
import { Qveris } from '@qverisai/sdk';

const qveris = Qveris.fromEnv(); // 读取 QVERIS_API_KEY

const discovered = await qveris.discover('weather forecast API', { limit: 5 });
const parameters: Record<string, unknown> = { city: 'London' };
const matchesType = (type: string, value: unknown) => {
  if (type === 'string') return typeof value === 'string';
  if (type === 'integer') return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return false;
};
const supportsRequest = (candidate: (typeof discovered.results)[number]) => {
  if (!candidate.params) return false;
  const definitions = new Map(candidate.params.map((parameter) => [parameter.name, parameter]));
  if (definitions.size !== candidate.params.length) return false;
  return Object.entries(parameters).every(([name, value]) => {
    const parameter = definitions.get(name);
    return Boolean(parameter && matchesType(parameter.type, value) &&
      (!parameter.enum || parameter.enum.some((allowed) => Object.is(allowed, value))));
  }) &&
    candidate.params.every((parameter) =>
      !parameter.required || Object.prototype.hasOwnProperty.call(parameters, parameter.name),
    );
};
let tool = discovered.results.find(supportsRequest);
if (!tool) {
  const inspected = await qveris.inspect(
    discovered.results.slice(0, 3).map((candidate) => candidate.tool_id),
    { searchId: discovered.search_id },
  );
  tool = inspected.results.find(supportsRequest);
}
if (!tool) throw new Error('没有候选能力提供包含 city 字段的当前契约。');
const result = await qveris.call(tool.tool_id, {
  parameters,
  searchId: discovered.search_id,
});
console.log(result.execution_id, result.success, result.billing);
```

---

### 直接调用 QVeris REST API

**基础 URL**

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
  -d "{\"query\":\"天气预报 API\",\"limit\":10}"
```

响应包含 `search_id` 和能力列表（每项含 `tool_id`、参数结构、示例等）。

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
    json={"query": "天气预报 API", "limit": 10},
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
  body: JSON.stringify({ query: "天气预报 API", limit: 10 }),
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

返回与 `/search` 相同的结构 — 包含完整能力详情、参数、示例和统计数据。

#### 3）调用能力

`POST /tools/execute?tool_id={tool_id}`

**cURL**（调用发现阶段返回的能力）

```bash
curl -sS -X POST "https://qveris.ai/api/v1/tools/execute?tool_id=openweathermap.weather.execute.v1" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"search_id\":\"YOUR_SEARCH_ID\",\"parameters\":{\"city\":\"London\",\"units\":\"metric\"},\"max_response_size\":20480}"
```

在兼容自动交付模式（未传 `respond_with`）下，输出超过 `max_response_size` 时，响应会包含 `truncated_content` 和临时的 `full_content_file_url`。显式传入 `respond_with: "full"` 则要求完整内联的 `result.data`；超过平台硬上限时会以 `response_too_large` 失败。

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
        "parameters": {"city": "北京", "units": "metric"},
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

### 在 AI 智能体中安装 QVeris

如果你正在配置 AI 编程助手或桌面端智能体（ChatGPT（Codex）、Claude Code、Cursor、GitHub Copilot、Cline、Roo Code、Continue、Kiro、Junie、Augment、Zed、Google Antigravity、Qoder、CodeBuddy、WorkBuddy、OpenCode、TRAE 等），可以将 [智能体安装指南](https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/agent/SETUP.md) 提供给智能体，但不要附带任何凭据。它会自动检测运行环境，并完成可用 MCP 服务器和技能定义的配置。客户端支持时，在浏览器中完成 OAuth 授权；否则通过客户端密钥存储或本地环境私密配置 `QVERIS_API_KEY`。不要将 API 密钥或认领码粘贴到安装提示词或聊天中。

支持 MCP 的桌面端客户端包括：ChatGPT（Codex）、Claude Desktop、Cursor、GitHub Copilot、Cherry Studio、Cline、Roo Code、Continue、Kiro、Junie、Augment、Zed、Google Antigravity、Qoder、CodeBuddy、WorkBuddy、OpenCode、TRAE、Windsurf 和 VS Code。

---

### 如何获取 API 密钥

1. 打开[控制台/API密钥](/account?page=api-keys)
2. 登录 / 注册账号（免费，注册验证后一次性获得 1,000 体验积分）
3. 创建 API 密钥
4. 使用方式：
   - `QVERIS_API_KEY` 环境变量（MCP / Python SDK），或
   - `Authorization: Bearer ...` 请求头（REST API）

---

### 推荐系统提示词

在启用 QVeris 工具时，将以下内容复制粘贴到助手的系统提示词中：

```text
你是一个有用的助手，可以动态发现并调用各种能力来帮助用户。首先思考完成用户任务可能需要哪类能力。然后使用 discover 工具，以描述能力的查询词进行搜索，而非直接写出你稍后要传入的具体参数。再使用 call 工具调用合适的能力，通过 params_to_tool 传入参数。如果能力具有 success_rate 和 avg_execution_time，请在选择时加以参考。你可以参考每个能力提供的示例。你可以在一次响应中发起多个工具调用。
```

---

### 开放生态

QVeris 的核心引擎是托管服务。所有客户端工具（MCP 服务器、SDK、技能、插件）均为开源：

- **GitHub 组织**：[github.com/orgs/QVerisAI/repositories](https://github.com/orgs/QVerisAI/repositories)
- **ClawHub 技能**：[clawhub.ai/skills?q=qveris](https://clawhub.ai/skills?sort=downloads&q=qveris)
- **npm 包**：[@qverisai](https://www.npmjs.com/org/qverisai)
- **上游贡献**：[openclaw/openclaw](https://github.com/openclaw/openclaw)、[openclaw/clawhub](https://github.com/openclaw/clawhub)
