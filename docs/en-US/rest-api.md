# QVeris REST API Documentation

Version: 2026-05-12

The public REST API exposes the core agent path:

| Protocol action | Endpoint | Cost behavior |
| --- | --- | --- |
| Discover | `POST /search` | Free; returns ranked capabilities and optional cost signals |
| Inspect | `POST /tools/by-ids` | Free; returns full schemas, examples, quality signals, and cost signals |
| Call | `POST /tools/execute` | May consume credits according to the selected capability's `billing_rule` |
| Usage audit | `GET /auth/usage/history/v2` | Final request status and charge outcome |
| Credits ledger | `GET /auth/credits/ledger` | Final credit balance movements |

Replace sample ids such as `srch_...`, `exec_...`, and `led_...` with ids returned by your own API responses.

## Base URL

```text
https://qveris.ai/api/v1
```

## Authentication

Send your API key in the `Authorization` header:

```text
Authorization: Bearer YOUR_API_KEY
```

## Cost and session contract

Discover and Inspect are free. They may return `expected_cost`, legacy `cost`, or `billing_rule` so clients can estimate Call cost before spending credits.

Call can return compact pre-settlement fields such as `billing` and `cost`. Final settlement is reported by usage audit and the credits ledger; use those endpoints for support, reconciliation, and user-facing billing history.

`session_id` is optional. Use one stable value per user task or conversation for tracing, analytics, and pricing context. It is not a cache contract and does not promise cache reuse or `session_cache_hit`.

## Search -> Execute integration contract

Treat Discover and Inspect as the source of truth for Call. A Call request should be built from the exact capability result that the user or agent selected.

Recommended contract:

1. Generate one stable `session_id` for a user task or conversation.
2. Call `POST /search` with a capability-level query.
3. Save the returned `search_id`.
4. Pick a `tool_id` from `results`.
5. Build `parameters` from that same result's `params`, `one_of_required`, and `examples.sample_parameters`.
6. Call `POST /tools/execute`, passing `tool_id`, `parameters`, `search_id`, `session_id`, and, for agent clients, `model`.
7. Save `execution_id` for audit and support.

Do not infer parameters from the tool name alone. Do not reuse parameters from another tool, another provider, or an old cached schema. If you cache tool metadata, use a short TTL or refresh it whenever the selected tool is returned by a new search.

`examples.sample_parameters` is a starter example, not a contract. Validate the final `parameters` against the current `params` schema before executing.

For LLM/agent integrations, include `model` in Call metadata whenever possible, for example `"model": "gpt-4.1"` or `"model": "deepseek-v4-pro"`. This helps correlate tool selection and parameter-generation quality with the model that produced the call.

## Billing transparency contract

QVeris separates pre-call estimate, execution outcome, pre-settlement billing, and final ledger settlement.

| Stage | Where to read it | Important fields | How to use it |
| --- | --- | --- | --- |
| Pre-call estimate | Discover / Inspect | `expected_cost`, `billing_rule` | Show users the pricing rule before executing a capability. |
| Execution result | Call | `success`, `error_message`, `execution_outcome` | Explain whether the provider/result was usable. Do not use `success` alone to decide final billing. |
| Pre-settlement bill | Call and usage audit | `billing`, `pre_settlement_bill`, `requested_amount_credits` | Show the amount requested before final settlement, discounts, or no-charge rules are applied. |
| Final request status | Usage audit | `charge_outcome`, `reason_code`, `settlement_result`, `actual_amount_credits` | Answer whether the request was finally charged and why. |
| Final balance movement | Credits ledger | `amount_credits`, `balance_before`, `balance_after`, `execution_id` | Reconcile account balance and support tickets. |

Recommended reconciliation flow:

1. Use Discover or Inspect to show `billing_rule` / `expected_cost`.
2. Call the capability and save `execution_id`, `billing`, `execution_outcome`, and legacy `cost`.
3. Query `/auth/usage/history/v2?execution_id=...` to read `charge_outcome`, `reason_code`, `actual_amount_credits`, and `credits_ledger_entry_id`.
4. Query `/auth/credits/ledger` or the linked ledger entry to verify the final signed balance movement.

Client guidance:

- REST clients should preserve `execution_id`, `billing`, `execution_outcome`, and `cost` from Call responses.
- CLI, MCP, and SDK clients should display the same machine-readable fields instead of translating them into unrelated local status names.
- Use stable machine fields such as `charge_outcome` and `reason_code` for automation; use `billing_summary` and `error_message` for user-facing text.
- `cost` is kept for backward compatibility. New billing UIs should prefer usage audit and credits ledger for final settlement.

## Rate limits

Rate limits are applied per API key when a Bearer token is present, otherwise per client IP.

| Action | Default quota |
| --- | --- |
| Discover (`POST /search`) | 120 requests/minute |
| Call (`POST /tools/execute`) | 200 requests/minute |

Rate-limited responses include:

| Header | Description |
| --- | --- |
| `X-RateLimit-Limit` | Maximum requests allowed in the current window |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Unix epoch seconds when the current window resets |
| `Retry-After` | Seconds until retry is recommended; always present on `429` |

## 1. Discover capabilities

```text
POST /search
```

### Request

```json
{
  "query": "weather forecast API",
  "limit": 10,
  "session_id": "sess_7Q9m"
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `query` | string | Yes | Natural-language capability query |
| `limit` | integer | No | Maximum result count; default `20`, range `1-100` |
| `session_id` | string | No | Tracking and pricing-context id for this user task |

### Success response

```json
{
  "query": "weather forecast API",
  "search_id": "srch_01HZX9QK7J3M9T",
  "total": 1,
  "results": [
    {
      "tool_id": "openweathermap.weather.execute.v1",
      "name": "Current Weather",
      "description": "Get current weather data for a city.",
      "provider_name": "OpenWeatherMap",
      "params": [
        {
          "name": "city",
          "type": "string",
          "required": true,
          "description": "City name"
        }
      ],
      "expected_cost": "5 credits per successful request",
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

### Response fields

| Field | Type | Description |
| --- | --- | --- |
| `query` | string | Original search query when available. |
| `search_id` | string | Search id returned by Discover. Use this id in later Inspect or Call requests. |
| `total` | integer | Number of capability results returned. |
| `results` | array | Ranked capability results. |
| `elapsed_time_ms` | number | Search elapsed time in milliseconds. |
| `remaining_credits` | number/null | Remaining account credits when available. |
| `error_message` | string/null | Error detail for business failures. |

### Capability result fields

| Field | Type | Description |
| --- | --- | --- |
| `tool_id` | string | Unique capability id used by Inspect and Call. |
| `name` | string | Human-readable capability name. |
| `description` | string | Capability description. |
| `provider_name` | string | Capability provider name. |
| `params` | array | Parameter definitions. Each item can include `name`, `type`, `required`, `description`, and `enum`. |
| `examples` | object | Example parameters when available. |
| `expected_cost` | string | Human-readable pre-call cost signal when available. |
| `billing_rule` | object | Structured cost signal when available. |
| `stats.avg_execution_time_ms` | number | Historical average execution time in milliseconds. |
| `stats.success_rate` | number | Historical success rate from `0` to `1`. |

### Error responses

Invalid API key:

```json
{
  "query": "weather forecast API",
  "search_id": "srch_failed",
  "total": 0,
  "results": []
}
```

Insufficient credits:

```json
{
  "query": "weather forecast API",
  "search_id": "srch_failed",
  "total": 0,
  "results": [],
  "error_message": "Insufficient credits",
  "remaining_credits": 0
}
```

Rate limited:

```json
{
  "status": "failure",
  "status_code": 429,
  "message": "Rate limit exceeded. Please try again later."
}
```

## 2. Inspect capabilities by id

```text
POST /tools/by-ids
```

Inspect returns the same capability result shape as Discover, usually with more complete parameters and examples.

### Request

```json
{
  "tool_ids": ["openweathermap.weather.execute.v1"],
  "search_id": "srch_01HZX9QK7J3M9T",
  "session_id": "sess_7Q9m"
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tool_ids` | string[] | Yes | Capability ids returned by Discover |
| `search_id` | string | No | Search id that returned the capability |
| `session_id` | string | No | Tracking and pricing-context id for this user task |

### Success response

```json
{
  "search_id": "srch_01HZX9QK7J3M9T",
  "total": 1,
  "results": [
    {
      "tool_id": "openweathermap.weather.execute.v1",
      "name": "Current Weather",
      "description": "Get current weather data for a city.",
      "provider_name": "OpenWeatherMap",
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
          "description": "Temperature units",
          "enum": ["metric", "imperial", "standard"]
        }
      ],
      "examples": {
        "sample_parameters": {
          "city": "London",
          "units": "metric"
        }
      },
      "expected_cost": "5 credits per successful request",
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

### Response fields

| Field | Type | Description |
| --- | --- | --- |
| `search_id` | string | Search id associated with the inspected tools when available. |
| `total` | integer | Number of capability results returned. |
| `results` | array | Capability results. Each item uses the same capability result fields as Discover. |
| `elapsed_time_ms` | number | Inspect elapsed time in milliseconds when available. |
| `remaining_credits` | number/null | Remaining account credits when available. |
| `error_message` | string/null | Error detail for business failures. |

### Error responses

Timeout:

```json
{
  "error": "Request timeout",
  "remaining_credits": 995
}
```

Unexpected proxy failure:

```json
{
  "error": "Tools by-ids failed: upstream service unavailable",
  "remaining_credits": 995
}
```

## 3. Call a capability

```text
POST /tools/execute?tool_id={tool_id}
```

You may pass `tool_id` as a query parameter or in the JSON body. Use the query parameter form when possible because it is easier to trace in logs.

### Request

```json
{
  "search_id": "srch_01HZX9QK7J3M9T",
  "session_id": "sess_7Q9m",
  "model": "gpt-4.1",
  "parameters": {
    "city": "London",
    "units": "metric"
  },
  "max_response_size": 20480
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tool_id` | string | Required overall | Unique id of the tool to execute. Provide it as the query parameter or in this JSON body. |
| `search_id` | string | Recommended | Search id that returned the selected tool |
| `session_id` | string | No | Tracking and pricing-context id; if omitted, the service may use the execution id |
| `model` | string | Recommended for agents | Model that selected the tool or generated the parameters, such as `gpt-4.1`, `deepseek-v4-pro`, or `claude-sonnet-4` |
| `parameters` | object | Yes | Capability-specific parameters from Inspect |
| `max_response_size` | integer | No | Truncate long responses; default `20480`, `-1` disables truncation |

Build `parameters` from the selected tool only:

- Use the selected result's `params` field as the required schema.
- Respect `required` and `enum` fields.
- For CAP capabilities, respect `one_of_required`; each group means at least one field in that group must be present.
- Use `examples.sample_parameters` only as a hint for shape and typical values.
- If a parameter error mentions a different provider or looks unrelated to the selected tool, re-run search or inspect the selected `tool_id`; it often means the client mixed schemas from two tools.

### Success response

```json
{
  "execution_id": "exec_01HZX9R2R4S2E",
  "result": {
    "data": {
      "temperature": 15.5,
      "description": "partly cloudy"
    }
  },
  "success": true,
  "error_message": null,
  "execution_time": 0.211,
  "elapsed_time_ms": 211,
  "billing": {
    "summary": "5 credits per successful request",
    "list_amount_credits": 5
  },
  "execution_outcome": {
    "outcome": "success",
    "reason_code": "result.valid",
    "provider_success": true,
    "billable_success": true,
    "result_valid": true,
    "user_message": "The provider returned a valid result."
  },
  "cost": 5,
  "remaining_credits": 990
}
```

### Response fields

| Field | Type | Description |
| --- | --- | --- |
| `execution_id` | string | Unique id for this execution. Replace sample `exec_...` values with ids returned by your response. |
| `result` | object | Tool result payload. Long responses may use the truncation shape below. |
| `success` | boolean | Whether the tool execution succeeded. Do not infer final charge outcome from this field alone. |
| `error_message` | string/null | Error detail when `success` is false. |
| `execution_time` | number | Execution elapsed time in seconds. This is the legacy execute response timing field. |
| `elapsed_time_ms` | number | Execution elapsed time in milliseconds when available. |
| `billing` | object | Compact pre-settlement billing statement when available. |
| `execution_outcome` | object | Structured result and billing outcome context when available. Includes stable fields such as `outcome`, `reason_code`, `provider_success`, `billable_success`, and `result_valid`. |
| `cost` | number | Legacy/pre-settlement cost signal when available. |
| `remaining_credits` | number/null | Remaining account credits when available. |

### Example: empty result, not charged

Some providers return a valid response that contains no usable result. In this case `success` can be `false`, the user message should explain the empty result, and the final usage audit should normally classify it as `failed_not_charged`.

```json
{
  "execution_id": "exec_01HZX9EMPTY",
  "result": {
    "data": {}
  },
  "success": false,
  "error_message": "The provider returned no results for the current parameters. Try different parameters.",
  "execution_time": 0.184,
  "elapsed_time_ms": 184,
  "billing": {
    "summary": "No charge: provider returned no usable result",
    "list_amount_credits": 0
  },
  "execution_outcome": {
    "outcome": "empty_result",
    "reason_code": "result.empty",
    "provider_success": true,
    "billable_success": false,
    "result_valid": false,
    "user_message": "The provider returned no usable result data; this call was not charged."
  },
  "cost": 0,
  "remaining_credits": 990
}
```

### Error responses

Missing `tool_id`:

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

Insufficient credits:

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

Upstream tool failure:

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

### Error troubleshooting

| Error category | Typical symptom | What to check | Recommended action |
| --- | --- | --- | --- |
| `tool_id` format error | The request is rejected before provider execution. | Was the full `tool_id` copied from Discover or Inspect? | Use the exact `tool_id` returned by the API. Do not shorten, normalize, or guess ids. |
| `tool_id` not found | The service cannot resolve the selected capability. | Is the tool stale, unavailable in this region, or from an old cache? | Run Discover again and execute a currently returned tool. |
| Parameter error | Missing required field, invalid enum, invalid type, invalid date range, or invalid code/ticker format. | Compare the request body with the selected tool's current `params`. | Regenerate `parameters` from the selected result or Inspect response. |
| Schema mismatch | Parameters look valid for a different provider or a different tool. | Did the agent choose one `tool_id` but fill parameters from another search result? | Keep `search_id`, selected result, and parameter schema together in one context object. |
| Permission or region error | Auth, OAuth, or region restriction appears before provider execution. | Is the account authorized? Is the client using the right regional API base URL? | Ask the user to connect OAuth, change region, or select another returned tool. |
| Provider failure | Parameters are accepted but upstream returns an HTTP/provider error. | Does `execution_outcome.reason_code` start with `provider.`? | Retry when appropriate, choose another provider, or share `execution_id` with support. |

When contacting support, include `execution_id`, `search_id`, `session_id`, `tool_id`, and, for agent clients, `model`. These fields make it possible to tell whether the failure came from search ranking, tool selection, parameter generation, local validation, or the third-party provider.

## Long tool responses

If the payload exceeds `max_response_size`, `result` may omit `data` and include truncation fields.

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

| Field | Description |
| --- | --- |
| `truncated_content` | Initial bytes of the tool response |
| `full_content_file_url` | Temporary URL for the full content |
| `message` | LLM-safe explanation of truncation |
| `content_schema` | JSON schema for the full content when available |

## 4. Usage audit — final request status

Use usage audit to answer: "Did this request succeed?", "Was a failed request charged?", and "Which execution should support review?" Agent, CLI, and MCP clients should prefer precise filters or `summary=true` instead of dumping full history into an LLM context.

### Endpoint

```text
GET /auth/usage/history/v2
```

### Request headers

| Header | Required | Description |
| --- | --- | --- |
| `Authorization` | Yes | Bearer API key |

### Query parameters

| Parameter | Type | Required | Description | Default / range |
| --- | --- | --- | --- | --- |
| `start_date` | string | No | Start of the audit window. Accepts `YYYY-MM-DD` or ISO-8601 datetime. | - |
| `end_date` | string | No | End of the audit window. `YYYY-MM-DD` expands to the end of that day. | - |
| `event_type` | string | No | Exact event type filter: `search`, `search_by_ids`, `tool_execute`, `capabilities_query`, or `model_call`. | - |
| `kind` | string | No | Higher-level grouping. `discover` maps to `search` + `search_by_ids`; `call` maps to `tool_execute` + `capabilities_query`; `model` maps to `model_call`. | - |
| `success` | boolean | No | Transport/business success flag recorded for the usage event. | - |
| `billable_success` | boolean | No | Billing-specific success flag when available. This can differ from transport success for provider/outcome edge cases. | - |
| `outcome` | string | No | Normalized execution outcome filter from `execution_outcome.outcome`. | - |
| `reason_code` | string | No | Normalized execution outcome reason, for example provider or validation reason codes. | - |
| `has_execution_outcome` | boolean | No | `true` returns only events with structured execution outcome; `false` returns only events without it. | - |
| `charge_outcome` | string | No | Final charge classification: `charged`, `included`, `failed_not_charged`, `failed_charged_review`. | - |
| `anomaly` | string | No | Audit anomaly filter: `failed_charged_review`, `missing_ledger_link`, `missing_billing_snapshot`. | - |
| `search_id` | string | No | Focus on events linked to a Discover request. | - |
| `execution_id` | string | No | Focus on one Call execution. Best filter for "was this call charged?" | - |
| `min_credits` | number | No | Minimum effective settled/requested credits. Must be `>= 0`. | - |
| `max_credits` | number | No | Maximum effective settled/requested credits. Must be `>= 0`. | - |
| `page` | integer | No | Page number. | Default `1`, minimum `1` |
| `page_size` | integer | No | Page size when `limit` is absent. | Default `50`, range `1-50000` |
| `summary` | boolean | No | Include server-side aggregates and high-signal samples. If both dates are omitted, the summary window defaults to the last 24 hours. | Default `false` |
| `bucket` | string | No | Summary time bucket. | `hour`, `day`, or `week`; auto-selects `day` for windows over 3 days, otherwise `hour` |
| `limit` | integer | No | Overrides returned sample size and clamps it to a context-safe maximum. Use this for Agent/CLI/MCP summaries. | `1-50`; default summary sample `10` |

### Charge outcome values

| Value | Meaning |
| --- | --- |
| `charged` | The effective success flag is true and the settled/effective credit amount is positive. |
| `included` | The effective success flag is true and the settled/effective credit amount is zero, for example included credits or a policy exemption. |
| `failed_not_charged` | The effective success flag is false and the settled/effective credit amount is zero. |
| `failed_charged_review` | The effective success flag is false but the settled/effective amount is positive; treat this as a support/review case. |

### Common reason codes

`reason_code` is stable enough for automation, filters, and support workflows. User-facing text can change; machine clients should prefer the code.

| Reason code | Typical charge outcome | User-facing meaning |
| --- | --- | --- |
| `result.valid` | `charged` or `included` | The provider returned usable data. |
| `result.partial_success` | `charged`, `included`, or `failed_not_charged` | The provider returned partial data; inspect the result and billing statement. |
| `result.empty` | `failed_not_charged` | The provider responded but returned no usable result data. |
| `provider.error` | `failed_not_charged` | The provider returned an error. |
| `provider.http_error` | `failed_not_charged` | The provider returned a non-success HTTP response. |
| `provider.rate_limited` | `failed_not_charged` | The upstream provider rate-limited the request. |
| `provider.auth_or_permission` | `failed_not_charged` | The upstream provider rejected auth or permission. |
| `transport.timeout` | `failed_not_charged` | QVeris did not receive a provider response before timeout. |
| `transport.no_response` | `failed_not_charged` | QVeris could not obtain a provider response. |
| `transport.execution_failed` | `failed_not_charged` | The execution path failed before a billable provider result was available. |
| `validation_error` | `failed_not_charged` | Request parameters were invalid or incomplete. |
| `tool_unavailable` | `failed_not_charged` | The selected capability is unavailable. |
| `region_restricted` | `failed_not_charged` | The selected capability is not available in the current region. |
| `oauth_signin_required` | `failed_not_charged` | The capability requires OAuth sign-in before execution. |

### Example: lookup one execution

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
        "source_ref_type": "execute_history",
        "source_ref_id": "2b7f7c4a-9f3a-4f61-8b59-3a983a8192a0",
        "session_id": "sess_7Q9m",
        "search_id": "srch_01HZX9QK7J3M9T",
        "execution_id": "exec_01HZX9R2R4S2E",
        "tool_id": "openweathermap.weather.execute.v1",
        "success": true,
        "charge_outcome": "charged",
        "reason_code": "result.valid",
        "duration_ms": 211,
        "billing_snapshot_status": "upstream_provided",
        "billing_rule_snapshot": {
          "unit": "request",
          "amount_credits": 5
        },
        "pre_settlement_bill": {
          "summary": "5 credits per successful request",
          "list_amount_credits": 5
        },
        "settlement_result": {
          "settled_amount_credits": 5
        },
        "pre_settlement_amount_credits": 5,
        "settled_amount_credits": 5,
        "actual_amount_credits": 5,
        "credits_ledger_entry_id": "led_01HZX9R39K6QZ",
        "display_target": "openweathermap.weather.execute.v1",
        "billing_summary": "5 credits per successful request",
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

### Example: context-safe summary

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

### Response fields

Top-level response uses the standard `APIResponse` envelope.

| Field | Type | Description |
| --- | --- | --- |
| `status` | string | `success` or `failure`. |
| `message` | string | Human-readable server message. |
| `status_code` | integer | Application status code. Success is `0`; validation failures use negative codes. |
| `data.items` | array | Usage events in reverse chronological order. |
| `data.total` | integer | Total rows matching filters. |
| `data.page` | integer | Current page. |
| `data.page_size` | integer | Effective returned item/sample size. If `limit` is set, it overrides `page_size` and is capped at `50`. |
| `data.summary` | object/null | Aggregate summary when `summary=true`; otherwise `null`. |

Important `data.items[]` fields:

| Field | Description |
| --- | --- |
| `event_type` | Canonical event type. `search` = Discover, `search_by_ids` = Inspect, `tool_execute` / `capabilities_query` = Call, `model_call` = model usage. |
| `search_id` / `execution_id` | Correlation ids for the Discover or Call flow. |
| `success` | Recorded success flag for the usage event. |
| `charge_outcome` | User-facing final charge classification. Use this instead of guessing from `success` alone. |
| `error_message` | Error details when available. |
| `duration_ms` | Request duration in milliseconds. |
| `request_payload` / `response_payload_summary` | Stored request/response summaries for audit. Agent clients should avoid dumping these by default. |
| `execution_outcome` and outcome fields | Structured provider/result outcome details when available. |
| `billing_rule_snapshot` | Billing rule captured at request time. |
| `pre_settlement_bill` | Pre-settlement billing statement captured before final ledger settlement. |
| `settlement_result` | Final settlement details when available. |
| `requested_amount_credits` / `actual_amount_credits` | Requested versus settled/effective credits. |
| `credits_ledger_entry_id` | Ledger row id when this usage event produced a final balance movement. |
| `display_target` / `billing_summary` | UI-safe target and billing summary. |

### Error responses

Invalid date or bucket:

```json
{
  "status": "failure",
  "message": "Invalid start_date format. Use YYYY-MM-DD or ISO-8601 datetime",
  "status_code": -7,
  "data": null
}
```

Invalid credit range:

```json
{
  "status": "failure",
  "message": "min_credits cannot be greater than max_credits",
  "status_code": -7,
  "data": null
}
```

## 5. Credits ledger — final balance movements

Use the credits ledger to explain the final account balance. Usage audit describes requests; the ledger describes immutable credit movements. A charged Call should normally have a usage event with `charge_outcome=charged` and a linked ledger item.

### Endpoint

```text
GET /auth/credits/ledger
```

### Request headers

| Header | Required | Description |
| --- | --- | --- |
| `Authorization` | Yes | Bearer API key |

### Query parameters

| Parameter | Type | Required | Description | Default / range |
| --- | --- | --- | --- | --- |
| `start_date` | string | No | Start of the ledger window. Accepts `YYYY-MM-DD` or ISO-8601 datetime. | - |
| `end_date` | string | No | End of the ledger window. `YYYY-MM-DD` expands to the end of that day. | - |
| `entry_type` | string | No | Exact ledger event type, for example `consume_tool_execute`. | - |
| `scope` | string | No | Preset entry-type group. `account_history` includes `grant_payment_recharge`, `consume_tool_search`, `consume_tool_execute`, and `consume_model_call`. | - |
| `direction` | string | No | Balance direction. `consume` returns negative credit movements; `grant` returns positive movements; `any` returns both. | Default `any`; allowed `consume`, `grant`, `any` |
| `min_credits` | number | No | Minimum absolute credit amount. For example `min_credits=5` matches both `-5` and `+5`. Must be `>= 0`. | - |
| `max_credits` | number | No | Maximum absolute credit amount. Must be `>= 0`. | - |
| `page` | integer | No | Page number. | Default `1`, minimum `1` |
| `page_size` | integer | No | Page size when `limit` is absent. | Default `50`, range `1-500` |
| `summary` | boolean | No | Include aggregate balance movement summary. If both dates are omitted, the summary window defaults to the last 24 hours. | Default `false` |
| `bucket` | string | No | Summary time bucket. | `hour`, `day`, or `week`; auto-selects `day` for windows over 3 days, otherwise `hour` |
| `limit` | integer | No | Overrides returned sample size and summary max-amount samples, capped for Agent/CLI/MCP use. | `1-50`; default summary sample `10` |

### Common `entry_type` values

| Value | Meaning |
| --- | --- |
| `grant_payment_recharge` | Credits granted by a recharge/payment. |
| `grant_welcome_bonus` | Welcome or promotional credit grant. |
| `grant_invitation_reward` | Invitation/referral credit grant. |
| `consume_tool_search` | Credits consumed for Discover when a deployment charges search. |
| `consume_tool_execute` | Credits consumed for a capability Call. |
| `consume_model_call` | Credits consumed for model calls. |
| `consume_payment_refund` | Credit movement related to a payment refund. |

### Example: recent Call charges

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
        "source_ref_type": "execute_history",
        "source_ref_id": "2b7f7c4a-9f3a-4f61-8b59-3a983a8192a0",
        "execution_id": "exec_01HZX9R2R4S2E",
        "pre_settlement_bill": {
          "execution_id": "exec_01HZX9R2R4S2E",
          "summary": "5 credits per successful request",
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

### Example: aggregate balance movements

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
        "source_ref_type": "execute_history",
        "source_ref_id": "2b7f7c4a-9f3a-4f61-8b59-3a983a8192a0",
        "execution_id": "exec_01HZX9R2R4S2E",
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

### Response fields

| Field | Type | Description |
| --- | --- | --- |
| `data.items` | array | Ledger rows in reverse chronological order. |
| `data.total` | integer | Total rows matching filters. |
| `data.page` / `data.page_size` | integer | Current page and effective returned item/sample size. |
| `data.summary` | object/null | Aggregate balance summary when `summary=true`; otherwise `null`. |

Important `data.items[]` fields:

| Field | Description |
| --- | --- |
| `entry_type` | Immutable ledger event type. |
| `amount_credits` | Signed balance movement. Negative values consume credits; positive values grant credits. |
| `source_system` | System that created the ledger row. |
| `source_ref_type` / `source_ref_id` | Source row reference for backend audit. |
| `execution_id` | Call execution id returned by `/tools/execute`; use this for user reconciliation. Present for Call ledger rows when available. |
| `pre_settlement_bill` | Billing snapshot before final settlement. |
| `settlement_result` | Final settlement result. |
| `balance_before` / `balance_after` | Balance snapshots around this movement when available. |
| `ledger_metadata` | Additional internal-safe metadata for audit/debugging. |
| `description` | Human-readable ledger description. |
| `created_at` | Creation timestamp. |

Summary fields:

| Field | Description |
| --- | --- |
| `total_entries` | Count of matching ledger rows. |
| `consume_count` / `grant_count` | Number of negative and positive movements. |
| `consumed_credits` / `granted_credits` | Absolute consumed and granted totals. |
| `net_amount_credits` | Signed net sum; grants positive, consumption negative. |
| `max_amount_items` | High-signal largest absolute movements, capped by `limit`. |
| `buckets` | Per-bucket time series for charts or compact Agent summaries. |

### Error responses

Invalid `direction`:

```json
{
  "status": "failure",
  "message": "Invalid direction. Use consume, grant, or any",
  "status_code": -7,
  "data": null
}
```

Invalid credit range:

```json
{
  "status": "failure",
  "message": "min_credits must be greater than or equal to 0",
  "status_code": -7,
  "data": null
}
```

## End-to-end smoke checklist

1. Create a fresh `session_id`.
2. Run Discover and save `search_id`.
3. Inspect the selected `tool_id`; confirm required `params` and pre-call cost fields.
4. Call with valid `parameters`; save `execution_id`.
5. Query usage audit by `execution_id`.
6. Query the credits ledger and confirm the final balance movement matches the audit outcome.

## OpenAPI

The public OpenAPI document is available in this repository at `docs/openapi/qveris-public-api.openapi.json`. It includes request bodies, response schemas, and examples for the Discover, Inspect, and Call path.
