# QVeris Cookbook

这些示例流程展示常见的发现 -> 检查 -> 调用模式。请将示例中的 `srch_...`、`exec_...`、`led_...` 替换为你自己 API 响应中返回的 ID。

## 示例 1：给智能体回答补充天气上下文

当用户询问实时天气，而智能体需要可靠外部能力时使用。

本固定示例直接查询完整工具 ID，以保证检查和调用步骤可以稳定复现。需要动态比较候选工具时，请改用自然语言能力描述。

```bash
export QVERIS_BASE_URL="https://qveris.ai/api/v1"
export QVERIS_SESSION_ID="weather-$(date +%s)"

curl -sS "$QVERIS_BASE_URL/search" \
  -H "Authorization: Bearer $QVERIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"openweathermap.weather.execute.v1","limit":3,"session_id":"'"$QVERIS_SESSION_ID"'"}'
```

调用前检查选中的工具：

```bash
curl -sS "$QVERIS_BASE_URL/tools/by-ids" \
  -H "Authorization: Bearer $QVERIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tool_ids":["openweathermap.weather.execute.v1"],
    "search_id":"srch_01HZX9QK7J3M9T",
    "session_id":"'"$QVERIS_SESSION_ID"'"
  }'
```

调用：

```bash
curl -sS "$QVERIS_BASE_URL/tools/execute?tool_id=openweathermap.weather.execute.v1" \
  -H "Authorization: Bearer $QVERIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "search_id":"srch_01HZX9QK7J3M9T",
    "session_id":"'"$QVERIS_SESSION_ID"'",
    "parameters":{"q":"北京"}
  }'
```

智能体处理建议：

- 保留 `search_id`、`execution_id` 和 `session_id` 作为 trace。
- 用 `result.data` 生成简短回答；原始 JSON 放日志或调试面板。
- 用户询问是否扣费时，用调用历史确认。

## 示例 2：花费积分前比较候选能力

当多个服务商都能满足同一需求时使用。

```bash
curl -sS "$QVERIS_BASE_URL/search" \
  -H "Authorization: Bearer $QVERIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"公司基本面 API","limit":5,"session_id":"finance-compare"}'
```

检查排名靠前的候选能力：

```bash
curl -sS "$QVERIS_BASE_URL/tools/by-ids" \
  -H "Authorization: Bearer $QVERIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tool_ids":[
      "provider_a.company_fundamentals.v1",
      "provider_b.company_fundamentals.v1"
    ],
    "search_id":"srch_finance_123",
    "session_id":"finance-compare"
  }'
```

选择清单：

- 参数 schema 匹配度优先于单纯高分。
- Call 前比较 `expected_cost` 和 `billing_rule`。
- `success_rate` 与 `avg_execution_time_ms` 是质量信号，不是承诺。
- Discover 和 Inspect 不应向用户计费；只有 Call 可能消耗积分。

## 示例 3：安全处理长响应

当结果可能过长、不适合直接放入 LLM 上下文时，使用 `max_response_size`。

```bash
curl -sS "$QVERIS_BASE_URL/tools/execute?tool_id=pubmed_refined.search_articles.v1" \
  -H "Authorization: Bearer $QVERIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "search_id":"srch_research_123",
    "session_id":"research-task",
    "parameters":{"query":"进化工程理论","limit":10},
    "max_response_size":1200
  }'
```

响应被截断时，`result` 可能包含：

```json
{
  "message": "Result content is too long. Use truncated_content or download full_content_file_url.",
  "truncated_content": "{\"query\":\"进化工程理论...\"",
  "full_content_file_url": "https://...",
  "content_schema": { "type": "object" }
}
```

智能体处理建议：

- `truncated_content` 足够时直接总结。
- 只有任务确实需要完整数据时才获取 `full_content_file_url`。
- 避免把大段原始 payload 直接贴回对话。

## 示例 4：审计失败调用

当 `success` 为 `false` 时，不要只根据错误文本判断是否扣费。用 `execution_id` 查询调用历史。

```bash
curl -sS "$QVERIS_BASE_URL/auth/usage/history/v2?execution_id=exec_01HZX9R2R4S2E" \
  -H "Authorization: Bearer $QVERIS_API_KEY"
```

检查 `charge_outcome`：

- `charged`：最终结算消耗了积分。
- `included`：调用被免费额度或策略覆盖。
- `failed_not_charged`：失败调用未扣费。
- `failed_charged_review`：需要复核或联系支持。
