# QVeris REST API 文档

版本：2026-05-12

公开 REST API 暴露核心 Agent 路径：

| 协议动作 | Endpoint | 成本行为 |
| --- | --- | --- |
| Discover | `POST /search` | 免费；返回排序后的能力和可选成本信号 |
| Inspect | `POST /tools/by-ids` | 免费；返回完整 schema、示例、质量信号和成本信号 |
| Call | `POST /tools/execute` | 可能按所选能力的 `billing_rule` 消耗积分 |
| 调用历史 | `GET /auth/usage/history/v2` | 最终请求状态和扣费结果 |
| 积分账本 | `GET /auth/credits/ledger` | 最终积分余额变动 |

请将示例中的 `srch_...`、`exec_...`、`led_...` 替换为你自己 API 响应中返回的 ID。

## Base URL

```text
https://qveris.cn/api/v1
```

## 身份认证

在 `Authorization` 请求头中发送 API key：

```text
Authorization: Bearer YOUR_API_KEY
```

## 成本与 session 合同

Discover 和 Inspect 免费。它们可能返回 `expected_cost`、旧字段 `cost` 或 `billing_rule`，让客户端在花费积分前估算 Call 成本。

Call 可能返回 `billing`、`cost` 等预结算字段。最终结算由调用历史和积分账本报告；客服、对账和用户账单历史应以这些端点为准。

`session_id` 可选。建议每个用户任务或会话使用一个稳定值，用于追踪、分析和计费上下文。它不是缓存合同，也不承诺缓存复用或 `session_cache_hit`。

## 限流

携带 Bearer token 时按 API key 限流，否则按客户端 IP 限流。

| 动作 | 默认额度 |
| --- | --- |
| Discover (`POST /search`) | 120 次/分钟 |
| Call (`POST /tools/execute`) | 200 次/分钟 |

限流响应包含：

| Header | 说明 |
| --- | --- |
| `X-RateLimit-Limit` | 当前窗口最大请求数 |
| `X-RateLimit-Remaining` | 当前窗口剩余请求数 |
| `X-RateLimit-Reset` | 当前窗口重置的 Unix 秒级时间戳 |
| `Retry-After` | 建议重试等待秒数；`429` 一定返回 |

## 1. 发现能力

```text
POST /search
```

### 请求

```json
{
  "query": "天气预报 API",
  "limit": 10,
  "session_id": "sess_7Q9m"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | string | 是 | 自然语言能力查询 |
| `limit` | integer | 否 | 最大结果数；默认 `20`，范围 `1-100` |
| `session_id` | string | 否 | 当前用户任务的追踪和计费上下文 ID |

### 成功响应

```json
{
  "query": "天气预报 API",
  "search_id": "srch_01HZX9QK7J3M9T",
  "total": 1,
  "results": [
    {
      "tool_id": "openweathermap.weather.execute.v1",
      "name": "当前天气",
      "description": "获取某城市的当前天气数据。",
      "provider_name": "OpenWeatherMap",
      "params": [
        {
          "name": "city",
          "type": "string",
          "required": true,
          "description": "城市名称"
        }
      ],
      "expected_cost": "每次成功请求 5 积分",
      "billing_rule": {
        "unit": "request",
        "amount_credits": 5
      },
      "stats": {
        "avg_execution_time_ms": 210.7,
        "success_rate": 0.982
      }
    }
  ],
  "elapsed_time_ms": 245.6,
  "remaining_credits": 995
}
```

### 响应字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `query` | string | 原始搜索查询（如果可用）。 |
| `search_id` | string | Discover 返回的搜索 id。后续 Inspect 或 Call 可复用该 id。 |
| `total` | integer | 返回的能力结果数量。 |
| `results` | array | 排序后的能力结果。 |
| `elapsed_time_ms` | number | 搜索耗时，单位毫秒。 |
| `remaining_credits` | number/null | 可用时返回账户剩余积分。 |
| `error_message` | string/null | 业务失败时的错误说明。 |

### 能力结果字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `tool_id` | string | Inspect 和 Call 使用的唯一能力 id。 |
| `name` | string | 面向用户的能力名称。 |
| `description` | string | 能力说明。 |
| `provider_name` | string | 能力提供方名称。 |
| `params` | array | 参数定义；每一项可包含 `name`、`type`、`required`、`description`、`enum`。 |
| `examples` | object | 可用时返回示例参数。 |
| `expected_cost` | string | 可用时返回面向用户的调用前成本提示。 |
| `billing_rule` | object | 可用时返回结构化成本提示。 |
| `stats.avg_execution_time_ms` | number | 历史平均执行耗时，单位毫秒。 |
| `stats.success_rate` | number | 历史成功率，范围 `0` 到 `1`。 |

### 错误响应

API key 无效：

```json
{
  "query": "天气预报 API",
  "search_id": "srch_failed",
  "total": 0,
  "results": []
}
```

积分不足：

```json
{
  "query": "天气预报 API",
  "search_id": "srch_failed",
  "total": 0,
  "results": [],
  "error_message": "Insufficient credits",
  "remaining_credits": 0
}
```

触发限流：

```json
{
  "status": "failure",
  "status_code": 429,
  "message": "Rate limit exceeded. Please try again later."
}
```

## 2. 按 id 检查能力

```text
POST /tools/by-ids
```

Inspect 返回与 Discover 相同的能力结果结构，通常包含更完整的参数和示例。

### 请求

```json
{
  "tool_ids": ["openweathermap.weather.execute.v1"],
  "search_id": "srch_01HZX9QK7J3M9T",
  "session_id": "sess_7Q9m"
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tool_ids` | string[] | 是 | Discover 返回的能力 id |
| `search_id` | string | 否 | 返回该能力的 search id |
| `session_id` | string | 否 | 当前用户任务的追踪和计费上下文 ID |

### 成功响应

```json
{
  "search_id": "srch_01HZX9QK7J3M9T",
  "total": 1,
  "results": [
    {
      "tool_id": "openweathermap.weather.execute.v1",
      "name": "当前天气",
      "description": "获取某城市的当前天气数据。",
      "provider_name": "OpenWeatherMap",
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
          "description": "温度单位",
          "enum": ["metric", "imperial", "standard"]
        }
      ],
      "examples": {
        "sample_parameters": {
          "city": "北京",
          "units": "metric"
        }
      },
      "expected_cost": "每次成功请求 5 积分",
      "billing_rule": {
        "unit": "request",
        "amount_credits": 5
      },
      "stats": {
        "avg_execution_time_ms": 210.7,
        "success_rate": 0.982
      }
    }
  ],
  "remaining_credits": 995
}
```

### 响应字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `search_id` | string | 可用时返回与本次检查关联的 search id。 |
| `total` | integer | 返回的能力结果数量。 |
| `results` | array | 能力结果；每一项使用与 Discover 相同的能力结果字段。 |
| `elapsed_time_ms` | number | 可用时返回 Inspect 耗时，单位毫秒。 |
| `remaining_credits` | number/null | 可用时返回账户剩余积分。 |
| `error_message` | string/null | 业务失败时的错误说明。 |

### 错误响应

超时：

```json
{
  "error": "Request timeout",
  "remaining_credits": 995
}
```

代理异常：

```json
{
  "error": "Tools by-ids failed: upstream service unavailable",
  "remaining_credits": 995
}
```

## 3. 调用能力

```text
POST /tools/execute?tool_id={tool_id}
```

`tool_id` 可以放在 query 参数或 JSON body 中。推荐使用 query 参数，便于日志追踪。

### 请求

```json
{
  "search_id": "srch_01HZX9QK7J3M9T",
  "session_id": "sess_7Q9m",
  "parameters": {
    "city": "北京",
    "units": "metric"
  },
  "max_response_size": 20480
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tool_id` | string | 整体必填 | 要执行的工具唯一标识符；可作为 query 参数或 JSON body 字段提供。 |
| `search_id` | string | 推荐 | 返回所选工具的 search id |
| `session_id` | string | 否 | 追踪和计费上下文 ID；省略时服务可能使用 execution id |
| `parameters` | object | 是 | Inspect 返回的能力专属参数 |
| `max_response_size` | integer | 否 | 长响应截断阈值；默认 `20480`，`-1` 表示不截断 |

### 成功响应

```json
{
  "execution_id": "exec_01HZX9R2R4S2E",
  "result": {
    "data": {
      "temperature": 15.5,
      "description": "局部多云"
    }
  },
  "success": true,
  "error_message": null,
  "execution_time": 0.211,
  "elapsed_time_ms": 211,
  "billing": {
    "summary": "每次成功请求 5 积分",
    "list_amount_credits": 5
  },
  "cost": 5,
  "remaining_credits": 990
}
```

### 响应字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `execution_id` | string | 本次执行的唯一 id。请将示例中的 `exec_...` 替换为你自己响应返回的 id。 |
| `result` | object | 工具执行结果；长响应可能使用下方的截断结构。 |
| `success` | boolean | 工具执行是否成功。不要只根据此字段判断最终是否扣费。 |
| `error_message` | string/null | `success=false` 时的错误说明。 |
| `execution_time` | number | 执行耗时，单位秒；这是 execute 响应的兼容字段。 |
| `elapsed_time_ms` | number | 可用时返回执行耗时，单位毫秒。 |
| `billing` | object | 可用时返回紧凑的预结算账单。 |
| `cost` | number | 可用时返回旧版/预结算成本信号。 |
| `remaining_credits` | number/null | 可用时返回账户剩余积分。 |

### 错误响应

缺少 `tool_id`：

```json
{
  "execution_id": "exec_01HZX9R2R4S2E",
  "result": {
    "data": {}
  },
  "success": false,
  "error_message": "Missing required parameter: tool_id. Provide it as query (?tool_id=xxx) or in JSON body.",
  "execution_time": 0.01
}
```

积分不足：

```json
{
  "execution_id": "exec_01HZX9R2R4S2E",
  "result": {
    "data": {}
  },
  "success": false,
  "error_message": "Insufficient credits",
  "execution_time": 0.01,
  "remaining_credits": 0
}
```

上游工具失败：

```json
{
  "execution_id": "exec_01HZX9R2R4S2E",
  "result": {
    "data": {}
  },
  "success": false,
  "error_message": "Execute API error: HTTP 502",
  "execution_time": 0.211,
  "remaining_credits": 990
}
```

## 长响应

当 payload 超过 `max_response_size` 时，`result` 可能不包含 `data`，而是返回截断字段。

```json
{
  "result": {
    "message": "Result content is too long. Use truncated_content or download full_content_file_url.",
    "full_content_file_url": "https://...",
    "truncated_content": "{\"query\":\"evolution\",\"total_results\":890994",
    "content_schema": {
      "type": "object"
    }
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `truncated_content` | 工具响应的前几个字节 |
| `full_content_file_url` | 完整内容的临时 URL |
| `message` | 适合给 LLM 读取的截断说明 |
| `content_schema` | 完整内容的 JSON schema（如果可用） |

## 4. 调用审计 — 最终请求状态

调用审计用于回答：“这次请求是否成功？”、“失败请求是否扣费？”、“哪一次执行需要客服复核？”。Agent、CLI、MCP 客户端应优先使用精确过滤或 `summary=true`，不要把全量历史直接输出给 LLM。

### 端点

```text
GET /auth/usage/history/v2
```

### 请求头

| 请求头 | 必填 | 说明 |
| --- | --- | --- |
| `Authorization` | 是 | Bearer API key |

### 查询参数

| 参数 | 类型 | 必填 | 说明 | 默认值 / 范围 |
| --- | --- | --- | --- | --- |
| `start_date` | string | 否 | 审计窗口开始时间。支持 `YYYY-MM-DD` 或 ISO-8601 datetime。 | - |
| `end_date` | string | 否 | 审计窗口结束时间。`YYYY-MM-DD` 会扩展到当天结束。 | - |
| `event_type` | string | 否 | 精确事件类型：`search`、`search_by_ids`、`tool_execute`、`capabilities_query`、`model_call`。 | - |
| `kind` | string | 否 | 高层分组。`discover` 对应 `search` + `search_by_ids`；`call` 对应 `tool_execute` + `capabilities_query`；`model` 对应 `model_call`。 | - |
| `success` | boolean | 否 | 使用事件记录的成功标记。 | - |
| `billable_success` | boolean | 否 | 计费侧成功标记；某些 provider/outcome 边界场景可能与 `success` 不同。 | - |
| `outcome` | string | 否 | `execution_outcome.outcome` 的标准化结果过滤。 | - |
| `reason_code` | string | 否 | 标准化执行原因，例如 provider 或参数校验原因。 | - |
| `has_execution_outcome` | boolean | 否 | `true` 只返回有结构化 execution outcome 的事件；`false` 只返回没有该结构的事件。 | - |
| `charge_outcome` | string | 否 | 最终扣费分类：`charged`、`included`、`failed_not_charged`、`failed_charged_review`。 | - |
| `anomaly` | string | 否 | 审计异常过滤：`failed_charged_review`、`missing_ledger_link`、`missing_billing_snapshot`。 | - |
| `search_id` | string | 否 | 聚焦到某次 Discover 相关事件。 | - |
| `execution_id` | string | 否 | 聚焦到某次 Call 执行；最适合回答“这次调用是否扣费”。 | - |
| `min_credits` | number | 否 | 最小有效结算/请求积分。必须 `>= 0`。 | - |
| `max_credits` | number | 否 | 最大有效结算/请求积分。必须 `>= 0`。 | - |
| `page` | integer | 否 | 页码。 | 默认 `1`，最小 `1` |
| `page_size` | integer | 否 | 未传 `limit` 时的每页数量。 | 默认 `50`，范围 `1-50000` |
| `summary` | boolean | 否 | 返回服务端聚合和高信号样本。若没有传日期，summary 默认最近 24 小时。 | 默认 `false` |
| `bucket` | string | 否 | summary 时间粒度。 | `hour`、`day`、`week`；超过 3 天自动用 `day`，否则用 `hour` |
| `limit` | integer | 否 | 覆盖返回样本数量，并限制在适合上下文的上限内。Agent/CLI/MCP 场景推荐使用。 | `1-50`；summary 默认样本 `10` |

### `charge_outcome` 取值

| 值 | 含义 |
| --- | --- |
| `charged` | 有效成功标记为 true，且最终/有效积分金额大于 0。 |
| `included` | 有效成功标记为 true，且最终/有效积分金额为 0，例如免费额度或策略豁免。 |
| `failed_not_charged` | 有效成功标记为 false，且最终/有效积分金额为 0。 |
| `failed_charged_review` | 有效成功标记为 false，但最终/有效积分金额大于 0；应作为客服/复核场景处理。 |

### 示例：按 execution_id 查询一次执行

```bash
curl -sS "$QVERIS_BASE_URL/auth/usage/history/v2?execution_id=exec_01HZX9R2R4S2E" \
  -H "Authorization: Bearer $QVERIS_API_KEY"
```

```json
{
  "status": "success",
  "message": "Usage events retrieved successfully",
  "status_code": 0,
  "data": {
    "items": [
      {
        "id": "evt_01HZX9R31GH2R",
        "event_type": "tool_execute",
        "source_system": "qveris_website",
        "source_ref_type": "tool_execute",
        "source_ref_id": "exec_01HZX9R2R4S2E",
        "session_id": "sess_7Q9m",
        "search_id": "srch_01HZX9QK7J3M9T",
        "execution_id": "exec_01HZX9R2R4S2E",
        "tool_id": "openweathermap.weather.execute.v1",
        "success": true,
        "charge_outcome": "charged",
        "duration_ms": 211,
        "billing_snapshot_status": "upstream_provided",
        "pre_settlement_amount_credits": 5,
        "settled_amount_credits": 5,
        "actual_amount_credits": 5,
        "credits_ledger_entry_id": "led_01HZX9R39K6QZ",
        "display_target": "openweathermap.weather.execute.v1",
        "billing_summary": "每次成功请求 5 积分",
        "created_at": "2026-05-16T08:30:12Z"
      }
    ],
    "total": 1,
    "page": 1,
    "page_size": 50,
    "summary": null
  }
}
```

### 示例：适合 Agent 上下文的聚合摘要

```bash
curl -sS "$QVERIS_BASE_URL/auth/usage/history/v2?summary=true&bucket=day&kind=call&limit=5&start_date=2026-05-01&end_date=2026-05-16" \
  -H "Authorization: Bearer $QVERIS_API_KEY"
```

```json
{
  "status": "success",
  "message": "Usage events retrieved successfully",
  "status_code": 0,
  "data": {
    "items": [
      {
        "id": "evt_01HZX9R31GH2R",
        "event_type": "tool_execute",
        "execution_id": "exec_01HZX9R2R4S2E",
        "tool_id": "openweathermap.weather.execute.v1",
        "success": true,
        "charge_outcome": "charged",
        "settled_amount_credits": 5,
        "created_at": "2026-05-16T08:30:12Z"
      }
    ],
    "total": 42,
    "page": 1,
    "page_size": 5,
    "summary": {
      "start_date": "2026-05-01T00:00:00Z",
      "end_date": "2026-05-16T23:59:59.999999Z",
      "bucket": "day",
      "total_count": 42,
      "success_count": 40,
      "failure_count": 2,
      "charge_outcome_counts": {
        "charged": 35,
        "included": 5,
        "failed_not_charged": 2,
        "failed_charged_review": 0
      },
      "pre_settlement_credits": 210,
      "settled_credits": 175,
      "max_charge_items": [],
      "buckets": [
        {
          "bucket_start": "2026-05-16T00:00:00Z",
          "total_count": 8,
          "success_count": 8,
          "failure_count": 0,
          "charged_count": 7,
          "included_count": 1,
          "failed_not_charged_count": 0,
          "failed_charged_review_count": 0,
          "pre_settlement_credits": 40,
          "settled_credits": 35
        }
      ]
    }
  }
}
```

### 响应字段

顶层响应使用标准 `APIResponse` 包装。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | string | `success` 或 `failure`。 |
| `message` | string | 服务端可读消息。 |
| `status_code` | integer | 应用状态码。成功为 `0`；校验失败为负数。 |
| `data.items` | array | 按时间倒序返回的 usage events。 |
| `data.total` | integer | 匹配过滤条件的总数。 |
| `data.page` | integer | 当前页码。 |
| `data.page_size` | integer | 实际返回样本数。若传 `limit`，它会覆盖 `page_size` 并被限制到 `50`。 |
| `data.summary` | object/null | `summary=true` 时返回聚合摘要，否则为 `null`。 |

重要 `data.items[]` 字段：

| 字段 | 说明 |
| --- | --- |
| `event_type` | 标准事件类型。`search` = Discover，`search_by_ids` = Inspect，`tool_execute` / `capabilities_query` = Call，`model_call` = 模型调用。 |
| `search_id` / `execution_id` | Discover 或 Call 流程的关联 id。 |
| `success` | 使用事件记录的成功标记。 |
| `charge_outcome` | 面向用户的最终扣费分类。不要只根据 `success` 猜测是否扣费。 |
| `error_message` | 可用时返回错误详情。 |
| `duration_ms` | 请求耗时，单位毫秒。 |
| `request_payload` / `response_payload_summary` | 审计用请求/响应摘要。Agent 客户端默认不应直接输出这些字段。 |
| `execution_outcome` 及 outcome 字段 | 可用时返回结构化 provider/result outcome。 |
| `billing_rule_snapshot` | 请求当时捕获的计费规则。 |
| `pre_settlement_bill` | 最终账本结算前的预结算账单。 |
| `settlement_result` | 可用时返回最终结算结果。 |
| `requested_amount_credits` / `actual_amount_credits` | 请求金额与最终/有效金额。 |
| `credits_ledger_entry_id` | 该 usage event 对应的最终账本行 id。 |
| `display_target` / `billing_summary` | 适合 UI 展示的目标和计费摘要。 |

### 错误响应

日期或 bucket 无效：

```json
{
  "status": "failure",
  "message": "Invalid start_date format. Use YYYY-MM-DD or ISO-8601 datetime",
  "status_code": -7,
  "data": null
}
```

积分区间无效：

```json
{
  "status": "failure",
  "message": "min_credits cannot be greater than max_credits",
  "status_code": -7,
  "data": null
}
```

## 5. Credits 账本 — 最终余额变动

Credits 账本用于解释最终账户余额。调用审计描述“请求发生了什么”；账本描述“余额如何不可变地变动”。一次已扣费的 Call 通常应该同时存在 `charge_outcome=charged` 的 usage event 和关联的账本行。

### 端点

```text
GET /auth/credits/ledger
```

### 请求头

| 请求头 | 必填 | 说明 |
| --- | --- | --- |
| `Authorization` | 是 | Bearer API key |

### 查询参数

| 参数 | 类型 | 必填 | 说明 | 默认值 / 范围 |
| --- | --- | --- | --- | --- |
| `start_date` | string | 否 | 账本窗口开始时间。支持 `YYYY-MM-DD` 或 ISO-8601 datetime。 | - |
| `end_date` | string | 否 | 账本窗口结束时间。`YYYY-MM-DD` 会扩展到当天结束。 | - |
| `entry_type` | string | 否 | 精确账本事件类型，例如 `consume_tool_execute`。 | - |
| `scope` | string | 否 | 预设事件类型组。`account_history` 包含 `grant_payment_recharge`、`consume_tool_search`、`consume_tool_execute`、`consume_model_call`。 | - |
| `direction` | string | 否 | 余额方向。`consume` 返回负数消耗；`grant` 返回正数发放；`any` 返回两者。 | 默认 `any`；允许 `consume`、`grant`、`any` |
| `min_credits` | number | 否 | 最小绝对积分金额。例如 `min_credits=5` 同时匹配 `-5` 和 `+5`。必须 `>= 0`。 | - |
| `max_credits` | number | 否 | 最大绝对积分金额。必须 `>= 0`。 | - |
| `page` | integer | 否 | 页码。 | 默认 `1`，最小 `1` |
| `page_size` | integer | 否 | 未传 `limit` 时的每页数量。 | 默认 `50`，范围 `1-500` |
| `summary` | boolean | 否 | 返回聚合余额变动摘要。若没有传日期，summary 默认最近 24 小时。 | 默认 `false` |
| `bucket` | string | 否 | summary 时间粒度。 | `hour`、`day`、`week`；超过 3 天自动用 `day`，否则用 `hour` |
| `limit` | integer | 否 | 覆盖返回样本数量和 summary 最大金额样本，适合 Agent/CLI/MCP 使用。 | `1-50`；summary 默认样本 `10` |

### 常见 `entry_type`

| 值 | 含义 |
| --- | --- |
| `grant_payment_recharge` | 充值/支付发放积分。 |
| `grant_welcome_bonus` | 新用户或活动赠送积分。 |
| `grant_invitation_reward` | 邀请/推荐奖励积分。 |
| `consume_tool_search` | Discover 消耗积分；仅在部署策略对搜索计费时出现。 |
| `consume_tool_execute` | 能力 Call 消耗积分。 |
| `consume_model_call` | 模型调用消耗积分。 |
| `consume_payment_refund` | 退款相关的积分变动。 |

### 示例：查询最近的 Call 扣费

```bash
curl -sS "$QVERIS_BASE_URL/auth/credits/ledger?entry_type=consume_tool_execute&page=1&page_size=10" \
  -H "Authorization: Bearer $QVERIS_API_KEY"
```

```json
{
  "status": "success",
  "message": "Credits ledger retrieved successfully",
  "status_code": 0,
  "data": {
    "items": [
      {
        "id": "led_01HZX9R39K6QZ",
        "entry_type": "consume_tool_execute",
        "amount_credits": -5,
        "source_system": "qveris_website",
        "source_ref_type": "tool_execute",
        "source_ref_id": "exec_01HZX9R2R4S2E",
        "pre_settlement_bill": {
          "summary": "每次成功请求 5 积分",
          "list_amount_credits": 5
        },
        "settlement_result": {
          "settled_amount_credits": 5
        },
        "balance_before": {
          "total_available_credits": 995
        },
        "balance_after": {
          "total_available_credits": 990
        },
        "description": "Tool execution charge",
        "created_at": "2026-05-16T08:30:13Z"
      }
    ],
    "total": 1,
    "page": 1,
    "page_size": 10,
    "summary": null
  }
}
```

### 示例：聚合余额变动

```bash
curl -sS "$QVERIS_BASE_URL/auth/credits/ledger?summary=true&scope=account_history&direction=any&bucket=day&limit=5&start_date=2026-05-01&end_date=2026-05-16" \
  -H "Authorization: Bearer $QVERIS_API_KEY"
```

```json
{
  "status": "success",
  "message": "Credits ledger retrieved successfully",
  "status_code": 0,
  "data": {
    "items": [
      {
        "id": "led_01HZX9R39K6QZ",
        "entry_type": "consume_tool_execute",
        "amount_credits": -5,
        "source_ref_id": "exec_01HZX9R2R4S2E",
        "created_at": "2026-05-16T08:30:13Z"
      }
    ],
    "total": 18,
    "page": 1,
    "page_size": 5,
    "summary": {
      "start_date": "2026-05-01T00:00:00",
      "end_date": "2026-05-16T23:59:59.999999",
      "bucket": "day",
      "total_entries": 18,
      "consume_count": 14,
      "grant_count": 4,
      "consumed_credits": 175,
      "granted_credits": 1000,
      "net_amount_credits": 825,
      "max_amount_items": [],
      "buckets": [
        {
          "bucket_start": "2026-05-16T00:00:00",
          "entry_count": 3,
          "consume_count": 3,
          "grant_count": 0,
          "consumed_credits": 15,
          "granted_credits": 0,
          "net_amount_credits": -15
        }
      ]
    }
  }
}
```

### 响应字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `data.items` | array | 按时间倒序返回的账本行。 |
| `data.total` | integer | 匹配过滤条件的总数。 |
| `data.page` / `data.page_size` | integer | 当前页码和实际返回样本数。 |
| `data.summary` | object/null | `summary=true` 时返回聚合余额摘要，否则为 `null`。 |

重要 `data.items[]` 字段：

| 字段 | 说明 |
| --- | --- |
| `entry_type` | 不可变账本事件类型。 |
| `amount_credits` | 带符号的余额变动。负数表示消耗，正数表示发放。 |
| `source_system` | 创建账本行的系统。 |
| `source_ref_type` / `source_ref_id` | 关联目标，通常是 execution id、search id、payment id 或 model call id。 |
| `pre_settlement_bill` | 最终结算前的计费快照。 |
| `settlement_result` | 最终结算结果。 |
| `balance_before` / `balance_after` | 可用时返回本次变动前后的余额快照。 |
| `ledger_metadata` | 用于审计/调试的附加元数据。 |
| `description` | 人类可读的账本说明。 |
| `created_at` | 创建时间。 |

Summary 字段：

| 字段 | 说明 |
| --- | --- |
| `total_entries` | 匹配账本行总数。 |
| `consume_count` / `grant_count` | 负数消耗和正数发放的条目数量。 |
| `consumed_credits` / `granted_credits` | 消耗和发放的绝对值总量。 |
| `net_amount_credits` | 带符号净额；发放为正，消耗为负。 |
| `max_amount_items` | 绝对金额最大的高信号样本，受 `limit` 限制。 |
| `buckets` | 按时间粒度聚合的时间序列，适合图表或 Agent 摘要。 |

### 错误响应

`direction` 无效：

```json
{
  "status": "failure",
  "message": "Invalid direction. Use consume, grant, or any",
  "status_code": -7,
  "data": null
}
```

积分区间无效：

```json
{
  "status": "failure",
  "message": "min_credits must be greater than or equal to 0",
  "status_code": -7,
  "data": null
}
```

## 端到端 smoke checklist

1. 创建新的 `session_id`。
2. 执行 Discover 并保存 `search_id`。
3. Inspect 所选 `tool_id`，确认必填 `params` 和调用前成本字段。
4. 使用有效 `parameters` 调用，并保存 `execution_id`。
5. 用 `execution_id` 查询调用历史。
6. 查询积分账本，确认最终余额变动与调用历史结果一致。

## OpenAPI

公开 OpenAPI 文档位于本仓库的 `docs/openapi/qveris-public-api.openapi.json`，包含 Discover、Inspect 和 Call 路径的请求体、响应 schema 与示例。
