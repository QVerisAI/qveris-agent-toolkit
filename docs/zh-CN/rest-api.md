# QVeris REST API 文档

版本：0.1.9

QVeris 通过 REST API 提供三个核心操作：

| 协议操作 | API 端点 | 说明 |
|---------|---------|------|
| **发现（Discover）** | `POST /search` | 使用自然语言搜索能力（免费） |
| **检查（Inspect）** | `POST /tools/by-ids` | 通过 ID 获取能力详情 |
| **调用（Call）** | `POST /tools/execute` | 执行一个能力（1–100 积分） |

## 身份认证

所有 API 请求须在 Authorization 请求头中以 Bearer 方式进行认证：

```
Authorization: Bearer YOUR_API_KEY
```

API 密钥请从 https://qveris.ai 获取。

## Base URL

```
https://qveris.ai/api/v1
```

本文档中所有端点均相对于此 Base URL。

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
| Authorization | 是 | 用于认证的 Bearer Token |
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
      "name": "Current Weather",
      "description": "Get current weather data for any location",
      "provider_name": "OpenWeatherMap",
      "provider_description": "Global weather data provider",
      "region": "global",
      "params": [
        {
          "name": "city",
          "type": "string",
          "required": true,
          "description": "City name"
        },
        {
          "name": "units",
          "type": "string",
          "required": false,
          "description": "Temperature units (metric/imperial)",
          "enum": ["metric", "imperial", "standard"]
        }
      ],
      "examples": {
        "sample_parameters": {
          "city": "London",
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
| Authorization | 是 | 用于认证的 Bearer Token |
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
| tool_ids | list of strings | 是 | 要查询的工具 ID 列表 | - | - |
| session_id | string | 否 | 相同 ID 对应同一用户会话 | - | - |
| search_id | string | 否 | 返回该工具的搜索 ID | - | - |

#### 响应

状态码：200 OK

响应 schema 与 `/search` 相同。

---

### 3. 调用 — 执行工具

使用指定参数调用一个能力。这是**调用（Call）**操作，每次调用消耗 **1–100 积分**，按数据和任务价值计费。

#### 端点

```
POST /tools/execute?tool_id={tool_id}
```

#### 请求头

| 请求头 | 必填 | 说明 |
| --- | --- | --- |
| Authorization | 是 | 用于认证的 Bearer Token |
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
    "city": "London",
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
      "description": "partly cloudy",
      "wind_speed": 12.5
    }
  },
  "success": true,
  "error_message": null,
  "elapsed_time_ms": 210.72,
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
| cost | number | 否 | 从账户扣除的积分数 |

若因第三方服务余额不足、配额超限或其他原因导致调用失败，`success` 将为 false，`error_message` 将包含详细的失败信息。

#### 超长响应字段说明

若工具生成的数据超过 `max_response_size` 字节，result 将不含 `data` 字段，而是包含以下字段：

```json
{
  "result": {
    "message": "Result content is too long (3210 bytes). You can reference the truncated content (200 bytes) and download the full content from the url provided.",
    "full_content_file_url": "http://qveris-tool-results-cache-bj.oss-cn-beijing.aliyuncs.com/tool_result_cache%2F20260120%2Fpubmed_refined.search_articles.v1%2F2409f329c07949a295b5ab0b704883ca.json?OSSAccessKeyId=LTAI5tM3qNRZSgSrg1iSTALm&Expires=1768920673&Signature=ThkQxoa9ryYHn%2F6XbVloiegS5ss%3D",
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
| content_schema | object | 否 | 完整内容的 JSON Schema |

---

## 数据模型

### 工具参数 Schema

每个工具参数遵循以下 schema：

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

## LLM / Agent 使用示例

以下代码片段展示了如何将 QVeris AI REST API 调用封装为可供大语言模型调用的工具：

```typescript
export async function searchTools(
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

export async function executeTool(
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
  searchTools,
  executeTool,
}

// 工具执行函数
async function executeTool(name: string, args: Record<string, unknown>) {
  console.log(`[Tool] Executing ${name} with:`, args)

  if (name === 'search_tools') {
    const result = await qverisApi.searchTools(
      args.query as string,
      args.session_id as string,
      20
    )
    return result
  } else if (name === 'execute_tool') {
    let parsedParams: Record<string, unknown>
    try {
      parsedParams = JSON.parse(args.params_to_tool as string) as
        Record<string, unknown>
    } catch (parseError) {
      throw new Error(
        `Invalid JSON in params_to_tool: ${
          parseError instanceof Error
            ? parseError.message
            : 'Unknown parse error'
        }`
      )
    }

    const result = await qverisApi.executeTool(
      args.tool_id as string,
      args.search_id as string,
      args.session_id as string,
      parsedParams
    )
    return result
  }

  throw new Error(`Unknown tool: ${name}`)
}
```

以下是封装后的搜索和执行工具的声明示例，可直接添加到 chat completion 的工具列表中：

```javascript
{
  type: 'function',
  function: {
    name: 'search_tools',
    description:
      'Search for available tools. Returns relevant tools that can help accomplish tasks.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query describing the general capability of the tool. Not specific params you want to pass to the tool later.',
        },
        session_id: {
          type: 'string',
          description: 'The uuid of the user session. Should be changed only if new session.'
        },
      },
      required: ['query'],
    },
  },
},
{
  type: 'function',
  function: {
    name: 'execute_tool',
    description:
      'Execute a specific remote tool with provided parameters. The tool_id must come from a previous search_tools call; The params_to_tool is where the params can be passed.',
    parameters: {
      type: 'object',
      properties: {
        tool_id: {
          type: 'string',
          description: 'The ID of the remote tool to execute (from search results)',
        },
        search_id: {
          type: 'string',
          description: 'The search_id in the response of the search_tools call that returned the information of this remote tool',
        },
        session_id: {
          type: 'string',
          description: 'The uuid of the user session. Should be changed only if new session.'
        },
        params_to_tool: {
          type: 'string',
          description: 'An JSON stringified dictionary of parameters to pass to the remote tool, where keys are param names and values can be of any type, used to pass multiple arguments to the tool. For example: { "param1": "value1", "param2": 42, "param3": { "nestedKey": "nestedValue" } }',
        },
        max_response_size: {
          type: 'integer',
          description: 'If tool generates data longer than max_response_size (in bytes), do not return the full data to avoid big LLM token cost. Default value is 20480.',
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
  content: 'You are a helpful assistant that can dynamically discover and call capabilities to help the user. First think about what kind of capabilities might be useful to accomplish the user\'s task. Then use the search_tools tool with a query describing the capability, not the specific parameters you will pass later. Then call suitable capabilities using the execute_tool tool, passing parameters through params_to_tool. If a capability has success_rate and avg_execution_time (in seconds), consider them when selecting which to call. You can reference the examples given for each capability. You can make multiple tool calls in a single response.',
}
```
