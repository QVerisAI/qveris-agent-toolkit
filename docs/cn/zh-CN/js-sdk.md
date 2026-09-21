# QVeris TypeScript SDK

类型化的 TypeScript/JavaScript SDK，让你在自己的 Agent 和应用中发现、检查、探测、调用并审计 丰富的 API 能力。

`@qverisai/sdk` v0.8.4 是最新测试版本。它是对 QVeris REST API（`discover`、`inspect`、`probe`、`call`、`credits`、`usage`、`ledger`）的轻量类型化封装，**零运行时依赖**——使用平台原生 `fetch`（Node.js 18+）——并与 [Python SDK](python-sdk.md) 和 [MCP 服务器](mcp-server.md) 保持一致的通信语义。

## 安装

```bash
npm install @qverisai/sdk
```

需要 Node.js 18+（原生 `fetch`）。该包仅支持 ESM。

## 认证

SDK 从环境变量 `QVERIS_API_KEY` 读取 API 密钥，并通过 `QVERIS_BASE_URL` 指向 API 地址。请设置：

```bash
export QVERIS_API_KEY="your-api-key"
export QVERIS_BASE_URL="https://qveris.cn/api/v1"
```

在[控制台/API密钥](/account?page=api-keys)中创建密钥。可从环境变量创建客户端，也可以显式传入配置：

```typescript
import { Qveris } from '@qverisai/sdk';

const qveris = Qveris.fromEnv();
// 或
const explicit = new Qveris({
  apiKey: 'your-api-key',
  baseUrl: 'https://qveris.cn/api/v1',
});
```

API 地址优先级为：显式 `baseUrl` > `QVERIS_BASE_URL`。API key 不参与地址选择；请按上面的示例设置地址。

## 快速开始

默认工作流是 **discover → call**，然后可选地**审计**发生了什么。`inspect` 和 `probe` 是按需检查，不是必经步骤。所有方法都返回 Promise。

进行 Provider 比较时，如果需要确认当前范围或完整契约，必须逐一 Inspect；Discover 摘要不等于确认。比较需要当前报价时，必须逐一 Probe。复用只能保留精确路由，不能保留业务参数或结果：参数必须来自当前请求；当前、最新、今天或其他时效性数据必须执行新的 Call。

```typescript
import { Qveris } from '@qverisai/sdk';

const qveris = Qveris.fromEnv();

// 1. 用自然语言发现能力（免费）
const discovered = await qveris.discover('weather forecast API', { limit: 5 });
const params: Record<string, unknown> = { city: 'London' };
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
  return Object.entries(params).every(([name, value]) => {
    const parameter = definitions.get(name);
    return Boolean(parameter && matchesType(parameter.type, value) &&
      (!parameter.enum || parameter.enum.some((allowed) => Object.is(allowed, value))));
  }) &&
    candidate.params.every((parameter) =>
      !parameter.required || Object.prototype.hasOwnProperty.call(params, parameter.name),
    );
};
let tool = discovered.results.find(supportsRequest);

// 2. 仅在 Discover 未提供选择所需契约时 Inspect
if (!tool) {
  const details = await qveris.inspect(
    discovered.results.slice(0, 3).map((candidate) => candidate.tool_id),
    { searchId: discovered.search_id },
  );
  tool = details.results.find(supportsRequest);
}
if (!tool?.params) throw new Error('没有候选能力提供当前有效的 city 参数契约');

// 3. 样例只作模板；覆盖为本次请求的真实业务值
const missing = tool.params.filter((parameter) => parameter.required && params[parameter.name] === undefined);
if (missing.length) throw new Error(`缺少业务输入：${missing.map((parameter) => parameter.name)}`);
const result = await qveris.call(tool.tool_id, {
  parameters: params,
  searchId: discovered.search_id,
  maxResponseSize: 20480,
});
console.log(result.success, result.result);

// 4. 审计最终扣费结果
const usage = await qveris.usage({ execution_id: result.execution_id, summary: true });
const ledger = await qveris.ledger({ summary: true, limit: 5 });
console.log(usage.total, ledger.total);
```

客户端基于 `fetch`、无状态，无需手动关闭连接。

无状态也意味着没有隐式语义路由、schema、费用或结果缓存。应在当前应用流程中保留真实 `search_id`。Host 如自行实现复用，必须按账户/API 地址/授权/会话隔离，根据当前请求重建业务值，并显式管理元数据失效。

显式空参数列表表示工具确实无参数；缺少参数列表表示当前投影没有提供契约。仅在选择或构造合法请求所需详情缺失/过期，或需要比较候选时使用 `inspect`。仅在参数需要校验、预算决策需要当前报价、或明确要求预检时使用 `probe`。报价不等于锁价，也不能代替用户授权。

## 配置参考

`new Qveris(config)` 接受：

| 字段 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| `apiKey` | `QVERIS_API_KEY` | —（未提供 `credentialProvider` 时必填） | API 密钥，以 `Authorization: Bearer ...` 发送 |
| `credentialProvider` | — | — | 异步 Bearer 凭证提供器；与 `apiKey` 互斥 |
| `credentialAudience` | — | — | 传给凭证提供器的 audience |
| `credentialScopes` | — | `[]` | 传给凭证提供器的 OAuth scopes |
| `baseUrl` | `QVERIS_BASE_URL` | 按上文设置 | API 基础地址；构造参数优先级最高 |
| `timeoutMs` | — | `30000` | 默认请求超时（`call` 默认 `120000`） |

`Qveris.fromEnv(overrides?)` 从 `QVERIS_API_KEY` 构建客户端，并接受相同的非密钥选项。

已登记的机密 Agent Runtime 可使用 `AgentDelegationCredentialProvider`，在
`https://qveris.cn/api/v1/oauth/token` 用用户 access token 换取委托 token。
客户端需配置相同的 `credentialAudience` 及其 `credentialScopes` 子集。委托 token
只驻留内存、不刷新，并在 audience 或 scope 扩大时失败。机密客户端 secret 必须
留在可信服务端，不能嵌入浏览器或移动端代码。

## API 参考

以下章节概述当前包公开导出的主要 class、method、option、响应类型和 AI SDK 集成。

### `Qveris`

| 方法 | REST 端点 | 用途 |
|------|-----------|------|
| `discover(query, options?)` | `POST /search` | 发现能力；`view: 'routing'` 返回精简 routing card（免费） |
| `inspect(toolIds, options?)` | `POST /tools/by-ids` | 获取能力完整元数据（免费） |
| `probe(toolId, options?)` | `POST /tools/probe` | 校验参数并请求零成本报价 |
| `call(toolId, options)` | `POST /tools/execute` | 执行能力；`model` 记录模型归因，`respondWith` 可选择完整、摘要或 JSONPath 字段 |
| `credits()` | `GET /auth/credits` | 当前积分余额与分桶 |
| `usage(filters?)` | `GET /auth/usage/history/v2` | 审计请求状态与扣费结果 |
| `ledger(filters?)` | `GET /auth/credits/ledger` | 查看最终积分余额变动 |

选项结构：

- `discover(query, { limit?, sessionId?, view?, lang?, timeoutMs? })`
- `inspect(toolIds, { searchId?, sessionId?, timeoutMs? })` —— `toolIds` 接受单个字符串或数组；**空数组会短路**，直接返回空响应而不发起网络请求。
- `probe(toolId, { parameters?, checks?, liveBudget?, subUserId?, timeoutMs? })`
- `call(toolId, { parameters, searchId?, sessionId?, subUserId?, model?, maxResponseSize?, respondWith?, timeoutMs?, compatibilityMode? })`

当 provider OAuth 按终端用户隔离时，Probe 与 Call 应使用相同的非空 `subUserId`；否则省略。该字段是用户身份，不是令牌。

使用框架工具时，由宿主代码绑定已认证身份：`getQverisTools(qveris, { subUserId: authenticatedUser.id })`。为每个终端用户创建独立工具集合，宿主侧 Probe 使用相同身份。该身份不向模型工具 schema 暴露，也不能被模型生成的参数覆盖。

投影参数仅在显式指定时发送。省略 `respondWith` 时保留兼容的自动交付：`maxResponseSize` 默认 20KB，超限结果使用溢出信封。显式 `respondWith: 'full'` 强制返回完整内联 `result.data`，优先于有限的 `maxResponseSize`；超过平台硬限制时返回 `response_too_large`，不会截断。摘要模式至少保留一种可用载荷：`summary` 对象、无损 `data`，或同时存在的 `truncated_content` 与 `full_content_file_url`。这些字段可以共存；仅凭模式不能保证摘要或下载链接存在。先检查 `success`，再检查字段是否存在；失败的摘要调用保留空 `data` 对象。

付费调用严格 single-submit：不会跟随 HTTP 重定向，`429`/`503` 和投影错误会直接返回，不会重放。已弃用的 `compatibilityMode: 'legacyOptionalFields'` 可显式允许一次删除旧服务拒绝的可选字段后重放；无效投影仍按错误返回。

`usage(...)` 和 `ledger(...)` 接受过滤对象，如 `start_date`、`end_date`、`summary`、`bucket`、`charge_outcome`、`execution_id`、`search_id`、`direction`、`entry_type`、`min_credits`、`max_credits`、`limit`、`page`、`page_size`。

## 类型化响应

所有方法返回与公开 OpenAPI 合同对齐的类型化结果。未知的后端字段会透传，因此新增的 API 元数据不会破坏旧版 SDK 客户端。

- 发现 / 检查：`SearchResponse` → `results: ToolInfo[]`；`ToolInfo` 含 `tool_id`、`name`、`description`、`categories`（对象或字符串）、`capabilities`、`params`、`examples`、`stats`、`billing_rule`、`expected_cost`，以及（仅 discover）`why_recommended`。
- 调用：`ExecuteResponse`，含 `execution_id`、`success`、`result`、`error_message`、`billing`（`CompactBillingStatement`）、`cost`、`remaining_credits`。
- 用量审计：`UsageEventsResponse` → `items: UsageEventItem[]`、`total`、`summary`。
- 积分账本：`CreditsLedgerResponse` → `items: CreditsLedgerItem[]`、`total`、`summary`。

```typescript
import type { ExecuteResponse } from '@qverisai/sdk';

function explain(result: ExecuteResponse): string {
  if (!result.success) return `failed: ${result.error_message}`;
  const charged = result.billing?.summary ?? 'no billing info';
  return `ok (${charged}); remaining=${result.remaining_credits}`;
}
```

## 接入你自己的 Agent 循环

### 复制的服务/任务上下文

安装页复制的 v1 JSON 是短期公开选择提示，不是 SDK 请求对象。接收用户提供的该上下文时，请使用权威 CLI 消费入口：

```bash
qveris call --context @context.json --params @params.json
```

该边界会拒绝凭证、PII、提示词、payload、可执行参数、重复/原型键和不支持的必需能力；普通未来字段会以结构化 warning 忽略。已过期的可用性/价格/权限快照通过 Discover 自动刷新；Inspect/Probe 按需执行，只有明确预算/报价策略或付费风险才把报价作为门禁。不要把 JSON 直接传给 `qveris.call`，也不要信任旧 `search_id`。

若应用明确要用 SDK 复现这条流程，必须保持参数分离，公开 ID 只作发现提示，service-only context 返回候选而不猜工具，要求准确的当前工具匹配，仅在当前验证需要时调用 `inspect` 或 `probe`，并把新发现的 `search_id` 传给 `call`。最终结算要通过 `usage` 和 `ledger` 对账；缺少最终审计数据表示未知，不能当作已扣费或免费。

类型化客户端天然可作为任何 LLM Agent 框架的工具后端。应指导模型默认使用 `discover` → `call`，只有缺少或需要刷新详情时才调用 `inspect`。由于 `discover` 会尽可能返回 `why_recommended`、参数指引和 `expected_cost`，模型不应习惯性检查每个候选。

## 框架集成

### Vercel AI SDK

把 QVeris 工作流暴露为 [Vercel AI SDK](https://sdk.vercel.ai) 工具。`ai` 和 `zod` 是 peer 依赖（从 `@qverisai/sdk/ai` 子路径导入）：

```bash
npm install @qverisai/sdk ai zod
```

```typescript
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { Qveris } from '@qverisai/sdk';
import { getQverisTools } from '@qverisai/sdk/ai';

const qveris = new Qveris({
  apiKey: process.env.QVERIS_API_KEY!,
  baseUrl: 'https://qveris.cn/api/v1',
});
const { text } = await generateText({
  model: openai('gpt-4o'),
  tools: getQverisTools(qveris), // qveris_discover / qveris_inspect / qveris_call
  maxSteps: 6,
  prompt: 'Find a stock quote capability and quote AAPL.',
});
```

[Python SDK](python-sdk.md) 还提供 LangChain/LangGraph、OpenAI Agents SDK、CrewAI、AutoGen、LlamaIndex 和 Pydantic AI 适配器。

## 错误处理

每个失败请求都会抛出 `QverisApiError`——一个 `Error` 子类，携带：

| 属性 | 说明 |
|------|------|
| `status` | HTTP 状态码（`0` 网络错误，`408` 超时，`402` 积分不足，……） |
| `details` | 服务端返回的错误体（如有） |
| `observability` | 请求上下文（operation、endpoint、request id），用于诊断 |
| `cause` | 更底层的传输/运行时原因（如有） |

```typescript
import { Qveris, QverisApiError } from '@qverisai/sdk';

const qveris = Qveris.fromEnv();
try {
  await qveris.call('some.tool.v1', { parameters: {} });
} catch (err) {
  if (err instanceof QverisApiError && err.status === 402) {
    // 积分不足 —— err.message 含购买链接
  }
}
```

`result.success` 只反映能力调用本身。**不要**把它当作最终扣费结果——请用 `usage(...)` / `ledger(...)` 确认扣费。

## 兼容性

- Node.js `>=18`（原生 `fetch`）。仅 ESM。
- 响应类型与公开方法尽量遵循增量兼容。
- 破坏性变更需要主版本号提升并附迁移说明。

> `@qverisai/sdk` 的 `0.1.x` 版本是早期以 MCP 为中心的 SDK，现已被 [`@qverisai/mcp`](mcp-server.md) 取代。本文档所述的类型化 REST 客户端从 **`0.2.0`** 起。

## 链接

- 包：[npm 上的 `@qverisai/sdk`](https://www.npmjs.com/package/@qverisai/sdk)
- 源码：[`packages/js-sdk`](https://github.com/QVerisAI/qveris-agent-toolkit/tree/main/packages/js-sdk)
- REST API：[rest-api.md](rest-api.md)
- 获取 API 密钥：[控制台/API密钥](/account?page=api-keys)
