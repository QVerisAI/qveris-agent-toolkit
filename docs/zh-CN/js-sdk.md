# QVeris TypeScript SDK

类型化的 TypeScript/JavaScript SDK，让你在自己的智能体和应用中发现、检查、调用并审计 10,000+ 真实已验证的 API 能力。

`@qverisai/sdk` v0.5.0 是最新测试版本。它是对 QVeris REST API（`discover`、`inspect`、`call`、`credits`、`usage`、`ledger`）的轻量类型化封装，**零运行时依赖**——使用平台原生 `fetch`（Node.js 18+）——并与 [Python SDK](python-sdk.md) 和 [MCP 服务器](mcp-server.md) 保持一致的通信语义。

## 安装

```bash
npm install @qverisai/sdk
```

需要 Node.js 18+（原生 `fetch`）。该包仅支持 ESM。

## 认证

SDK 从环境变量 `QVERIS_API_KEY` 读取 API 密钥：

```bash
export QVERIS_API_KEY="sk-..."
```

在[控制台/API密钥](/account?page=api-keys)中创建密钥。可从环境变量创建客户端，也可以显式传入配置：

```typescript
import { Qveris } from '@qverisai/sdk';

const qveris = Qveris.fromEnv();
// 或
const explicit = new Qveris({ apiKey: 'sk-...' });
```

API 地址优先级为：显式 `baseUrl` > `QVERIS_BASE_URL` > 内置默认值。API key 不参与地址选择。如需指向自定义端点，可显式传入 `baseUrl` 或设置 `QVERIS_BASE_URL`：

```typescript
const client = new Qveris({ apiKey: 'sk-...', baseUrl: 'https://qveris.ai/api/v1' });
```

## 快速开始

核心工作流是 **discover → inspect → call**，然后可选地**审计**发生了什么。所有方法都返回 Promise。

```typescript
import { Qveris } from '@qverisai/sdk';

const qveris = Qveris.fromEnv();

// 1. 用自然语言发现能力（免费）
const discovered = await qveris.discover('weather forecast API', { limit: 5 });
const tool = discovered.results[0];

// 2. 检查所选能力的完整参数
const inspected = await qveris.inspect(tool.tool_id, { searchId: discovered.search_id });
const selected = inspected.results[0];

// 3. 在不执行或扣费的情况下校验参数并获取报价
const params = selected.examples?.sample_parameters ?? { city: 'London' };
const probe = await qveris.probe(selected.tool_id, {
  parameters: params,
  checks: ['schema', 'quote'],
});

// 4. 调用（可能消耗积分）
const result = await qveris.call(selected.tool_id, {
  parameters: params,
  searchId: discovered.search_id,
  maxResponseSize: 20480,
});
console.log(result.success, result.result);

// 5. 审计最终扣费结果
const usage = await qveris.usage({ execution_id: result.execution_id, summary: true });
const ledger = await qveris.ledger({ summary: true, limit: 5 });
console.log(usage.total, ledger.total);
```

客户端基于 `fetch`、无状态，无需手动关闭连接。

## 配置参考

`new Qveris(config)` 接受：

| 字段 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| `apiKey` | `QVERIS_API_KEY` | —（必填） | API 密钥，以 `Authorization: Bearer ...` 发送 |
| `baseUrl` | `QVERIS_BASE_URL` | `https://qveris.ai/api/v1` | API 基础地址；构造参数优先级最高 |
| `timeoutMs` | — | `30000` | 默认请求超时（`call` 默认 `120000`） |

`Qveris.fromEnv(overrides?)` 从 `QVERIS_API_KEY` 构建客户端，并接受相同的非密钥选项。

## API 参考

[根据源码生成的符号参考](js-sdk-api.md)列出当前包公开导出的全部 class、method、option、响应类型和
AI SDK 集成。该页面直接根据 TypeScript 源码重新生成，并由 CI 检查是否漂移。

### `Qveris`

| 方法 | REST 端点 | 用途 |
|------|-----------|------|
| `discover(query, options?)` | `POST /search` | 发现能力；`view: 'routing'` 返回精简 routing card（免费） |
| `inspect(toolIds, options?)` | `POST /tools/by-ids` | 获取能力完整元数据（免费） |
| `call(toolId, options)` | `POST /tools/execute` | 执行能力；`respondWith` 可选择完整、摘要或 JSONPath 字段 |
| `credits()` | `GET /auth/credits` | 当前积分余额与分桶 |
| `usage(filters?)` | `GET /auth/usage/history/v2` | 审计请求状态与扣费结果 |
| `ledger(filters?)` | `GET /auth/credits/ledger` | 查看最终积分余额变动 |

选项结构：

- `discover(query, { limit?, sessionId?, view?, lang?, timeoutMs? })`
- `inspect(toolIds, { searchId?, sessionId?, timeoutMs? })` —— `toolIds` 接受单个字符串或数组；**空数组会短路**，直接返回空响应而不发起网络请求。
- `call(toolId, { parameters, searchId?, sessionId?, maxResponseSize?, respondWith?, timeoutMs? })`

投影参数仅在显式指定时发送。旧服务返回 `422 extra_forbidden` 时仅移除对应可选字段并重试一次；无效投影仍按错误返回。

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

## 接入你自己的智能体循环

类型化客户端天然可作为任何 LLM 智能体框架的工具后端：把 `discover` / `inspect` / `call` 作为工具暴露给模型，再把工具调用路由回客户端。由于 `discover` 返回 `why_recommended` 和 `expected_cost`，你的智能体可以在调用前对能力进行排序和预算控制。

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

const qveris = new Qveris({ apiKey: process.env.QVERIS_API_KEY! });
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
