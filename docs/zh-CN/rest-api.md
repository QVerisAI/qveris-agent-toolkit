# QVeris REST API 文档

版本：0.1.9

QVeris 通过 REST API 提供三个核心能力操作和两个审计读取入口：

| 协议操作 | API 端点 | 说明 |
|---------|---------|------|
| **发现（Discover）** | `POST /search` | 使用自然语言搜索能力（免费） |
| **检查（Inspect）** | `POST /tools/by-ids` | 通过 ID 获取能力详情 |
| **调用（Call）** | `POST /tools/execute` | 执行能力；响应可能包含预结算 `billing` |
| **调用审计** | `GET /auth/usage/history/v2` | 查询调用状态和收费结果 |
| **积分账本** | `GET /auth/credits/ledger` | 查询最终积分余额变动 |

## 身份认证

所有 API 请求须在 Authorization 请求头中以 Bearer 方式进行认证：

```
Authorization: Bearer YOUR_API_KEY
```

API 密钥请从 https://qveris.ai 获取。

## 基础 URL

```
https://qveris.ai/api/v1
```

本文档中所有端点均相对于此基础 URL。

## API 端点

### 1. 发现 — 搜索工具

基于自然语言查询搜索能力。这是**发现（Discover）**操作，**免费**使用。

#### 端点

```
POST /search
```

#### 请求头

| 请求头 | 必填 | 说明 |
| --- | --- | --- |
| Authorization | 是 | 用于认证的 Bearer 令牌 |
| Content-Type | 是 | 必须为 application/json |

#### 请求体

```json
{
  "query": "string",
  "limit": 10,
  "session_id": "string"
}
```

#### 参数

| 字段 | 类型 | 必填 | 说明 | 默认值 | 范围 |
| --- | --- | --- | --- | --- | --- |
| query | string | 是 | 自然语言搜索查询 | - | - |
| session_id | string | 否 | 相同 ID 对应同一用户会话 | - | - |
| limit | integer | 否 | 最大返回结果数 | 20 | 1-100 |

#### 响应

状态码：200 OK

```json
{
  "search_id": "string",
  "total": 3,
  "results": [
    {
      "tool_id": "openweathermap.weather.execute.v1",
      "name": "当前天气",
      "description": "获取任意位置的当前天气数据",
      "provider_name": "OpenWeatherMap",
      "provider_description": "全球天气数据提供商",
      "region": "global",
      "params": [
        {
          "name": "city",
          "type": "string",
          "required": true,
          "description": "城市名称"
        },
        {
          "name": "units",
          "type": "string",
          "required": false,
          "description": "温度单位（metric/imperial）",
          "enum": ["metric", "imperial", "standard"]
        }
      ],
      "examples": {
        "sample_parameters": {
          "city": "北京",
          "units": "metric"
        }
      },
      "stats": {
          "avg_execution_time_ms": 21.74,
          "success_rate": 0.909
      }
    }
  ],
  "elapsed_time_ms": 245.6
}
```

#### 响应字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| query | string | 否 | 原始搜索查询 |
| search_id | string | 是 | 本次搜索的 ID，用于后续工具调用 |
| user_id | string | 否 | 原始搜索用户 ID |
| total | integer | 是 | 结果总数 |

#### 工具信息字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| tool_id | string | 是 | 工具的唯一标识符 |
| name | string | 是 | 工具显示名称 |
| description | string | 是 | 工具功能的详细描述 |
| provider_name | string | 否 | 工具提供商名称 |
| provider_description | string | 否 | 提供商描述 |
| region | string | 否 | 工具适用地域。"global" 表示全球，"\|" 分隔的白名单（如 "US\|CA"）或黑名单（如 "-CN\|RU"）表示指定国家/地区代码 |
| params | array | 否 | 参数定义数组 |
| examples | object | 否 | 使用示例 |
| stats | object | 否 | 历史执行性能统计数据 |

---

### 2. 检查 — 通过 ID 获取工具

根据 tool_id 获取能力的详细描述。这是**检查（Inspect）**操作。

#### 端点

```
POST /tools/by-ids
```

#### 请求头

| 请求头 | 必填 | 说明 |
| --- | --- | --- |
| Authorization | 是 | 用于认证的 Bearer 令牌 |
| Content-Type | 是 | 必须为 application/json |

#### 请求体

```json
{
  "tool_ids": ["string1", "string2", "..."],
  "search_id": "string",
  "session_id": "string"
}
```

#### 参数

| 字段 | 类型 | 必填 | 说明 | 默认值 | 范围 |
| --- | --- | --- | --- | --- | --- |
| tool_ids | 字符串数组 | 是 | 要查询的工具 ID 列表 | - | - |
| session_id | string | 否 | 相同 ID 对应同一用户会话 | - | - |
| search_id | string | 否 | 返回该工具的搜索 ID | - | - |

#### 响应

状态码：200 OK

响应结构与 `/search` 相同。

---

### 3. 调用 — 执行工具

使用指定参数调用一个能力。这是**调用（Call）**操作；响应可能包含紧凑的 `billing` 预结算信息。最终是否扣费应通过调用审计或积分账本确认。

#### 端点

```
POST /tools/execute?tool_id={tool_id}
```

#### 请求头

| 请求头 | 必填 | 说明 |
| --- | --- | --- |
| Authorization | 是 | 用于认证的 Bearer 令牌 |
| Content-Type | 是 | 必须为 application/json |

#### URL 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| tool_id | string | 是 | 要执行的工具的唯一标识符 |

#### 请求体

```json
{
  "search_id": "string",
  "session_id": "string",
  "parameters": {
    "city": "北京",
    "units": "metric"
  },
  "max_response_size": 20480
}
```

#### 参数

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| search_id | string | 是 | 返回该工具的搜索 ID |
| session_id | string | 否 | 相同 ID 对应同一用户会话 |
| parameters | object | 是 | 工具参数的键值对，值可以为对象 |
| max_response_size | integer | 否 | 若工具生成数据超过此字节数则截断，避免大量 LLM token 消耗。-1 表示无限制，默认 20480（20K）。详见下方说明 |

#### 响应

状态码：200 OK

```json
{
  "execution_id": "string",
  "result": {
    "data": {
      "temperature": 15.5,
      "humidity": 72,
      "description": "多云间晴",
      "wind_speed": 12.5
    }
  },
  "success": true,
  "error_message": null,
  "elapsed_time_ms": 210.72,
  "billing": {
    "summary": "每次成功请求 5 积分",
    "list_amount_credits": 5.0
  },
  "cost": 5.0
}
```

#### 响应字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| execution_id | string | 是 | 本次执行的唯一标识符 |
| result | object | 是 | 工具执行结果 |
| success | boolean | 是 | 执行是否成功 |
| error_message | string | 否 | 执行失败时的错误信息 |
| elapsed_time_ms | number | 否 | 执行耗时（毫秒） |
| billing | object | 否 | 紧凑的预结算账单 |
| cost | number | 否 | 旧版回退估算字段；最终扣费请看调用审计和积分账本 |

若因第三方服务余额不足、配额超限或其他原因导致调用失败，`success` 将为 false，`error_message` 将包含详细的失败信息。若需确认失败调用是否扣费，请用 `execution_id` 查询 `/auth/usage/history/v2` 并查看 `charge_outcome`。

### 调用审计

```
GET /auth/usage/history/v2
```

用于查询调用是否成功、失败和是否收费。智能体客户端应默认使用聚合摘要或精确过滤，不应直接输出全量历史。

常用查询参数：`start_date`、`end_date`、`summary`、`bucket`、`limit`、`execution_id`、`search_id`、`charge_outcome`、`min_credits`、`max_credits`、`page`、`page_size`。

智能体 / CLI / MCP 场景应传 `summary=true` 获取服务端聚合摘要与有限样本；`bucket` 支持 `hour`、`day`、`week`，`limit` 服务端硬上限为 50。日期支持 `YYYY-MM-DD` 或 ISO-8601 日期时间。

### 积分账本

```
GET /auth/credits/ledger
```

用于解释最终积分余额变动。智能体客户端应按时间聚合，或使用金额/时间精确过滤。

常用查询参数：`start_date`、`end_date`、`summary`、`bucket`、`limit`、`entry_type`、`direction`、`min_credits`、`max_credits`、`page`、`page_size`。

智能体 / CLI / MCP 场景应传 `summary=true` 获取服务端聚合摘要与有限样本；`bucket` 支持 `hour`、`day`、`week`，`limit` 服务端硬上限为 50。`direction` 支持 `consume`、`grant`、`any`。

#### 超长响应字段说明

若工具生成的数据超过 `max_response_size` 字节，result 将不含 `data` 字段，而是包含以下字段：

```json
{
  "result": {
    "message": "结果内容过长（3210 字节）。你可以参考截断内容（200 字节），并通过提供的 URL 下载完整内容。",
    "full_content_file_url": "https://oss.qveris.ai/tool_result_cache%2F20260120%2Fpubmed_refined.search_articles.v1%2F2409f329c07949a295b5ab0b704883ca.json?OSSAccessKeyId=YOUR_ACCESS_KEY_ID&Expires=1768920673&Signature=YOUR_SIGNATURE",
    "truncated_content": "{\"query\": \"evolution\", \"sort\": \"relevance\", \"total_results\": 890994, \"returned\": 10, \"articles\": [{\"pmid\": \"34099656\", \"title\": \"Towards an engineering theory of evolution.\", \"journal\": \"Nature commun",
    "content_schema": {
      "type": "object",
      "properties": {
        "query": { "type": "string" },
        "sort": { "type": "string" },
        "total_results": { "type": "number" },
        "returned": { "type": "number" },
        "articles": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "pmid": { "type": "string" },
              "title": { "type": "string" },
              "journal": { "type": "string" }
            }
          }
        }
      }
    }
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| truncated_content | string | 否 | 工具响应的前 max_response_size 字节内容 |
| full_content_file_url | string | 否 | 包含完整内容的文件 URL，有效期 120 分钟 |
| message | string | 否 | 告知 LLM 截断情况的说明信息 |
| content_schema | object | 否 | 完整内容的 JSON 结构 |

---

## 数据模型

### 工具参数结构

每个工具参数遵循以下结构：

```json
{
  "name": "string",
  "type": "string|number|boolean|array|object",
  "required": true,
  "description": "string",
  "enum": ["option1", "option2"]
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| name | string | 是 | 参数名称 |
| type | string | 是 | 数据类型（string、number、boolean、array、object） |
| required | boolean | 是 | 该参数是否必填 |
| description | string | 是 | 参数描述 |
| enum | array | 否 | 有效枚举值（若适用） |

### 搜索结果中的历史执行性能统计

```json
{
  "avg_execution_time_ms": 8564.43,
  "success_rate": 0.748
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| avg_execution_time_ms | number | 否 | 工具的历史平均执行时间 |
| success_rate | number | 否 | 工具的历史成功率 |

---

## LLM / 智能体使用示例

以下代码片段展示了如何将 QVeris AI REST API 调用封装为可供大语言模型调用的工具：

```typescript
export async function discoverCapabilities(
  query: string,
  sessionId: string,
  limit: number = 20
): Promise<SearchResponse> {
  const response = await api.post<SearchResponse>('/search', {
    query,
    limit,
    session_id: sessionId,
  })
  return response.data
}

export async function callCapability(
  toolId: string,
  searchId: string,
  sessionId: string,
  parameters: object
): Promise<ToolExecutionResponse> {
  const response = await api.post<ToolExecutionResponse>(
    `/tools/execute?tool_id=${toolId}`,
    {
      search_id: searchId,
      session_id: sessionId,
      parameters,
    }
  )
  return response.data
}

export const qverisApi = {
  discover: discoverCapabilities,
  call: callCapability,
}

// 将模型工具调用分发到 QVeris
async function handleModelToolCall(name: string, args: Record<string, unknown>) {
  console.log(`[工具] 正在执行 ${name}，参数为：`, args)

  if (name === 'discover') {
    const result = await qverisApi.discover(
      args.query as string,
      args.session_id as string,
      20
    )
    return result
  } else if (name === 'call') {
    let parsedParams: Record<string, unknown>
    try {
      parsedParams = JSON.parse(args.params_to_tool as string) as
        Record<string, unknown>
    } catch (parseError) {
      throw new Error(
        `params_to_tool 中的 JSON 无效：${
          parseError instanceof Error
            ? parseError.message
            : '未知解析错误'
        }`
      )
    }

    const result = await qverisApi.call(
      args.tool_id as string,
      args.search_id as string,
      args.session_id as string,
      parsedParams
    )
    return result
  }

  throw new Error(`未知工具：${name}`)
}
```

以下是封装后的 canonical `discover` 和 `call` 工具声明示例，可直接添加到聊天补全的工具列表中。

旧 MCP 名称（`search_tools`、`get_tools_by_ids`、`execute_tool`）仍作为兼容别名支持，但新的工具声明应使用 `discover`、`inspect` 和 `call`。

```javascript
{
  type: 'function',
  function: {
    name: 'discover',
    description:
      '发现可用能力。返回有助于完成任务的相关工具。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '描述工具通用能力的搜索查询，不是稍后要传给工具的具体参数。',
        },
        session_id: {
          type: 'string',
          description: '用户会话的 UUID。仅在开启新会话时更换。'
        },
      },
      required: ['query'],
    },
  },
},
{
  type: 'function',
  function: {
    name: 'call',
    description:
      '使用提供的参数调用指定远程能力。tool_id 和 search_id 必须来自此前的 discover 调用；params_to_tool 用于传递能力参数。',
    parameters: {
      type: 'object',
      properties: {
        tool_id: {
          type: 'string',
          description: '要执行的远程工具 ID（来自搜索结果）',
        },
        search_id: {
          type: 'string',
          description: '返回该远程工具信息的 discover 调用响应中的 search_id',
        },
        session_id: {
          type: 'string',
          description: '用户会话的 UUID。仅在开启新会话时更换。'
        },
        params_to_tool: {
          type: 'string',
          description: '要传给远程工具的参数字典，需序列化为 JSON 字符串。键为参数名，值可以是任意类型，用于向工具传递多个参数。例如：{ "param1": "value1", "param2": 42, "param3": { "nestedKey": "nestedValue" } }',
        },
        max_response_size: {
          type: 'integer',
          description: '如果工具生成的数据超过 max_response_size（字节），不返回完整数据，以避免过高的 LLM token 成本。默认值为 20480。',
        },
      },
      required: ['tool_id', 'search_id', 'params_to_tool'],
    },
  },
}
```

添加完工具声明后，使用以下系统提示词即可开始测试：

```javascript
{
  role: 'system',
  content: '你是一个有用的助手，可以动态发现并调用各种能力来帮助用户。首先思考完成用户任务可能需要哪类能力。然后使用 discover 工具，以描述能力的查询词进行搜索，而不是直接写出稍后要传入的具体参数。再使用 call 工具调用合适的能力，并通过 params_to_tool 传递参数。如果能力具有 success_rate 和 avg_execution_time_ms，请在选择时加以参考。你可以参考每个能力提供的示例。你可以在一次响应中发起多个工具调用。',
}
```
