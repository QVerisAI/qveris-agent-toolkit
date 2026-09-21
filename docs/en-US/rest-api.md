# QVeris REST API Documentation

Version: 2026-09-21.1

The public REST API exposes the core agent path:

| Protocol action | Endpoint | Cost behavior |
| --- | --- | --- |
| Discover | `POST /search` | Free; returns ranked capabilities and optional cost signals |
| Inspect | `POST /tools/by-ids` | Free; returns full schemas, examples, quality signals, and cost signals |
| Probe | `POST /tools/probe` | Free; validates parameters and returns a pre-call quote without execution |
| Call | `POST /tools/execute` | May consume credits according to the selected capability's `billing_rule` |
| Usage audit | `GET /auth/usage/history/v2` | Final request status and charge outcome |
| Credits ledger | `GET /auth/credits/ledger` | Final credit balance movements |

Replace sample ids such as `srch_...`, `exec_...`, and `led_...` with ids returned by your own API responses.

Focused references: [Discover](api-reference/discover.md), [Inspect](api-reference/inspect.md), [Probe](api-reference/probe.md), [Call](api-reference/call.md). The sidebar and public [OpenAPI JSON](/openapi.json) cover every published operation.

## Base URL

```text
https://qveris.ai/api/v1
```

## Authentication

Send your API key in the `Authorization` header:

```text
Authorization: Bearer YOUR_API_KEY
```

## Anonymous trial registration (recommended for agents)

Agents that need a key without waiting on human email verification can start
with an anonymous trial. The account is valid for 7 days, receives 50 trial
credits, and can call `search`/`execute`, but cannot use the model gateway.

```bash
curl -X POST https://qveris.ai/api/v1/agent/anonymous-register \
  -H "Content-Type: application/json" \
  -d '{"agent_name":"demo-agent"}'
```

Save the returned `api_key` and `claim_code`. The API key is shown only once.

When the trial needs to become a formal account, claim it with an email:

```bash
# Step 1: bind the email and receive a 6-digit verification code
curl -X POST https://qveris.ai/api/v1/agent/claim \
  -H "Content-Type: application/json" \
  -d '{"claim_code":"<claim_code>","email":"operator@example.com"}'

# Step 2: verify the code; the existing API key remains active
curl -X POST https://qveris.ai/api/v1/agent/claim-verify \
  -H "Content-Type: application/json" \
  -d '{"claim_code":"<claim_code>","email":"operator@example.com","code":"123456"}'
```

Human operators can also open the [claim page](/claim) on the website. Claim
codes cannot be bound to an email that already belongs to a formal account.

## Cost and session contract

Discover, Inspect, and Probe are free. Discover and Inspect may return `expected_cost`, legacy `cost`, or `billing_rule`; Probe validates the selected parameters and returns a zero-cost quote before spending credits.

Every capability returned by Discover or Inspect, and every successful Probe, includes `verification_status`, the supporting `verification` checks, and `execution_restrictions`. Only `verified` means the complete evidence is current. Verification is an evidence claim, not an execution prerequisite: other states remain discoverable and may become executable when the current input, authorization, permission, region, and exact price facts are resolved. Use `confidence`, the independent readiness axes, `allowed_actions`, `blocked_actions`, and `next_action` to inspect, authorize, probe, confirm a budget, retry, or switch providers. The legacy `callable` field describes immediate execution readiness; it does not control Discover or Inspect visibility.

The default/full Call response can return compact pre-settlement fields such as `billing` and `cost`. Projection responses (`summary` and `fields:*`) intentionally omit billing internals to keep the response small. Final settlement is reported by usage audit and the credits ledger; use those endpoints for support, reconciliation, and user-facing billing history.

`session_id` is optional. Use one stable value per user task or conversation for tracing, analytics, and pricing context. It is not a cache contract and does not promise cache reuse or `session_cache_hit`.

## Conditional Discover -> Call integration contract

Use the selected capability's current contract as the source of truth for Call. A full Discover result can be enough to call directly. Inspect only when the selected result omits required contract detail, its metadata may be stale, or you need to compare candidates. Probe only when the parameters need preflight validation or a budget decision needs a current quote.

Recommended contract:

1. Generate one stable `session_id` for a user task or conversation.
2. Call `POST /search` with a capability-level query.
3. Save the returned `search_id`.
4. Select a result that fits the requested capability, provider, freshness, and cost constraints. Check `verification_status` and disclose eligibility, license, region, data-as-of, and commercial-use restrictions before execution. Do not take the first result and attach unrelated sample parameters.
5. If the result has a complete current `params` contract, build `parameters` from it. An explicit empty contract describes a true zero-parameter capability; an omitted or incomplete contract requires Inspect. Ask the user for missing business inputs instead of guessing them.
6. Call `POST /tools/probe?tool_id=...` only when you need schema validation or a current quote. An exact Probe quote can resolve the price-readiness check for the current request; an estimate without a bound still requires budget confirmation. A Probe quote is not a price reservation or authorization to execute.
7. Call `POST /tools/execute`, passing `tool_id`, `parameters`, `search_id`, `session_id`, and, for agent clients, `model`.
8. Save `execution_id` for audit and support. Do not automatically replay a paid Call when its execution outcome is unknown.

Do not infer parameters from the tool name alone. Do not reuse parameters from another tool, another provider, or an old cached schema. If you cache tool metadata, use a short TTL or refresh it whenever the selected tool is returned by a new search.

`examples.sample_parameters` is a starter example, not a contract or user intent. Preserve required, enum, and alternative/one-of constraints, but replace sample business values with values from the current request.

For LLM/agent integrations, include `model` in Call metadata whenever possible, for example `"model": "gpt-4.1"` or `"model": "deepseek-v4-pro"`. This helps correlate tool selection and parameter-generation quality with the model that produced the call.

## Service/task context for installation

After a user selects a current service or tool, a discovery surface may send its public selection to the [Plugins page](/plugins). This is a manual handoff, not an execution or authorization contract: the installation page validates the context and lets the user copy exact IDs or a JSON template into their agent. It never copies request parameters, a user prompt, or an API key into the URL.

Version 1 uses these query parameters:

| Parameter | Required | Contract |
| --- | --- | --- |
| `context_version` | Recommended | Producer contract version. Missing values default to version `1`; newer versions remain usable when their minimum consumer version is supported. |
| `context_min_version` | No | Oldest consumer version that can safely interpret the stable fields. A value above the consumer version triggers refresh while preserving safe public IDs. |
| `context_issued_at` | Yes | Unix time in seconds. It may be at most five minutes ahead of the consumer clock. |
| `context_expires_at` | Yes | Unix time in seconds, later than `context_issued_at`, with a maximum lifetime of 24 hours. |
| `task_id` | Yes | Public task identifier, 1–128 characters. |
| `service_id` | Conditional | Public service identifier. At least one of `service_id` or `tool_id` is required. |
| `tool_id` | Conditional | Exact public tool identifier returned by Discover or Inspect. |
| `template_id` | No | Public template identifier; it is not template content or a prompt. |
| `platform` | No | An installation-page platform identifier already supported by the Plugins page. |
| `extensions.<namespace>.<field>` | No | Forward-compatible public metadata. Names and values use the same restricted public-ID alphabet; private or credential-shaped values are removed. |

Public IDs must start with an ASCII letter or digit and may contain only ASCII letters, digits, `.`, `_`, `:`, `/`, or `-`. Producers must not put `prompt`, `query`, `parameters`, `payload`, `api_key`, `token`, `authorization`, credentials, PII, or other private data in an installation URL. The consumer strictly removes those values. Ordinary unknown fields are ignored with a warning instead of invalidating the whole handoff. Safe field-name casing, surrounding whitespace, and equivalent duplicates are canonicalized; conflicting duplicates, ambiguity, and security risks are rejected.

Example shape (generate fresh timestamps; do not reuse these literal values):

```text
/plugins?context_version=1&context_issued_at=1800000000&context_expires_at=1800003600&task_id=company-latest-filing&service_id=service.market-data.v1&tool_id=provider.company.lookup.v1&template_id=filing-summary.v1
```

The handoff remains in the same site-relative URL during login. On return, the installation page automatically revalidates it. Expiration invalidates only discovery-time snapshots such as availability, price, and permission signals; safe task intent and public service/tool/task/template IDs remain available for one-click rediscovery. Changing the selected installation platform also preserves safe public intent.

Recoverable and rejected states expose a structured issue with `code`, `retryable`, `next_action`, and `preserved_safe_fields`. Consumers should follow `next_action` rather than deleting the whole handoff. Safe warnings use stable codes such as `unknown_field_ignored`, `duplicate_collapsed`, and `newer_version_accepted`.

Troubleshooting:

| Message | Meaning | Recovery |
| --- | --- | --- |
| Snapshot expired | Availability, price, permission, or terms may have changed. | Use the one-click [Tool Finder](/discover) action to rediscover with the preserved safe task intent. |
| Context incomplete | `task_id` or both service/tool identifiers are absent or malformed. | Rediscover while preserving any remaining safe public IDs. |
| Invalid snapshot | Timestamps are malformed, future-issued beyond clock tolerance, reversed, or longer than 24 hours. | Refresh discovery metadata; do not discard safe task intent. |
| Version refresh required | `context_min_version` is newer than the consumer. | Refresh from [Tool Finder](/discover); stable public IDs remain preserved. |
| Ambiguous context | The same canonical field has conflicting values. | Resolve the producer conflict before applying the handoff. |
| Unsafe context | The URL included a credential, PII, prompt, parameters, payload, or another dangerous field. | Remove private data at the producer boundary. Rotate a credential if it was exposed before removal. |

The installation page provides guidance only. A valid context, copied template, or installation confirmation does not prove service availability and must not be counted as a tool call, useful result, charge, or settlement. Immediately before execution, clients must strictly re-confirm authentication, authorization, current price, limits, parameter schema, provider/upstream status, and any required user approval. If execution fails, use the returned structured state to rediscover or refresh instead of silently replaying a paid call.

## Billing transparency contract

QVeris separates pre-call estimate, execution outcome, pre-settlement billing, and final ledger settlement.

| Stage | Where to read it | Important fields | How to use it |
| --- | --- | --- | --- |
| Pre-call estimate | Discover / Inspect | `expected_cost`, `billing_rule` | Show users the pricing rule before executing a capability. |
| Execution result | Call | `success`, `error_message` | Explain whether the provider/result was usable. Do not use `success` alone to decide final billing. |
| Provider/result outcome | Usage audit | `execution_outcome`, `reason_code`, `billable_success` | Inspect structured provider and result classification without expanding the Call response. |
| Pre-settlement bill | Default/full Call and usage audit | `billing`, `pre_settlement_bill`, `requested_amount_credits` | Show the amount requested before final settlement, discounts, or no-charge rules are applied. |
| Final request status | Usage audit | `charge_outcome`, `reason_code`, `settlement_result`, `actual_amount_credits` | Answer whether the request was finally charged and why. |
| Final balance movement | Credits ledger | `amount_credits`, `balance_before`, `balance_after`, `execution_id` | Reconcile account balance and support tickets. |

Recommended reconciliation flow:

1. Use Discover or Inspect to show `billing_rule` / `expected_cost`.
2. Call the capability and save `execution_id` and legacy `cost`; default/full clients may also save compact `billing`.
3. Query `/auth/usage/history/v2?execution_id=...` to read `charge_outcome`, `reason_code`, `actual_amount_credits`, and `credits_ledger_entry_id`.
4. Query `/auth/credits/ledger` or the linked ledger entry to verify the final signed balance movement.

Client guidance:

- REST clients should preserve `execution_id` and `cost` from Call responses. Read structured outcome and final billing details from usage audit.
- CLI, MCP, and SDK clients should keep projected Call responses compact and fetch audit details only when needed.
- Use stable audit fields such as `charge_outcome` and `reason_code` for automation; use `billing_summary` and `error_message` for user-facing text.
- `cost` is kept for backward compatibility. New billing UIs should prefer usage audit and credits ledger for final settlement.

## Rate limits

Authenticated rate limits are shared by all API keys owned by the same account. Anonymous website traffic is limited per client IP.

| Action | Default quota |
| --- | --- |
| Discover (`POST /search`) | 120 requests/minute |
| Inspect (`POST /tools/by-ids`) | 120 requests/minute |
| Probe (`POST /tools/probe`) | 120 requests/minute |
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

This walkthrough uses the exact tool ID as its query so every following step is reproducible. For dynamic discovery, pass a natural-language capability description and select one of the returned tools.

```json
{
  "query": "openweathermap.weather.execute.v1",
  "limit": 10,
  "session_id": "sess_7Q9m"
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `query` | string | Yes | Natural-language capability query, or an exact tool ID for deterministic lookup |
| `limit` | integer | No | Maximum result count; default `20`, range `1-100` |
| `session_id` | string | No | Tracking and pricing-context id for this user task |
| `view` | string | No | Response projection: `routing` returns compact routing cards plus required verification and restriction fields; `full` or omitted returns the complete shape. |
| `lang` | string | No | Response language, `zh` or `en`; defaults to `Accept-Language` negotiation |

### Success response (verification objects abbreviated)

For readability, this walkthrough omits the required `verification` and `execution_restrictions` objects from the JSON sample. Use the fields below or the OpenAPI schema for their complete shape.

```json
{
  "query": "openweathermap.weather.execute.v1",
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
          "name": "q",
          "type": "string",
          "required": true,
          "description": "Location query accepted by the weather provider."
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
| `verification_status` | string | Evidence state: `unverified`, `verifying`, `verified`, `stale`, `failed`, or `restricted`. Only `verified` asserts complete current evidence; other states remain visible with recovery guidance. |
| `verification` | object | Policy version, required checks, evidence timestamps, test-run digest, and quality issues. |
| `execution_restrictions` | object | Immediate callability plus eligibility, license, region, data-as-of, and commercial-use restrictions. |
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
  "query": "openweathermap.weather.execute.v1",
  "search_id": "srch_failed",
  "total": 0,
  "results": []
}
```

Insufficient credits:

```json
{
  "query": "openweathermap.weather.execute.v1",
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
| `view` | string | No | Response projection: `lean` trims per-capability metadata for model context; `full` or omitted returns the complete shape |

### Success response (verification objects abbreviated)

Each result also contains the required `verification_status`, `verification`, and `execution_restrictions` fields described under Discover.

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
          "name": "q",
          "type": "string",
          "required": true,
          "description": "Location query accepted by the weather provider."
        }
      ],
      "examples": {
        "sample_parameters": {
          "q": "London"
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

## 3. Probe a capability

```text
POST /tools/probe?tool_id={tool_id}
```

Probe is an optional preflight that validates candidate parameters or returns a current quote without executing the capability or consuming credits. Use it when validation or a quote is needed for the task; it is not required before Call. The response includes `recovery` with missing fields, safe fixes, retryability, the next action, and provider-fallback guidance. Missing noncritical metadata lowers confidence or produces a warning instead of hiding the capability; explicit safety, identity, legal, region, budget, or irreversible-execution conflicts still block the corresponding action.

### Request

```json
{
  "parameters": {
    "q": "London"
  },
  "checks": ["schema", "quote"],
  "live_budget": "none"
}
```

Use the exact `tool_id` selected during Discover or Inspect. Keep `live_budget` set to `none` for a validation-only probe.

### Success response (verification fields abbreviated)

```json
{
  "schema": {
    "valid": true
  },
  "quote": {
    "estimate_credits": 5,
    "currency": "credits",
    "exact": true,
    "basis": "per_call"
  },
  "recovery": {
    "missing_fields": [],
    "safe_fixes": [],
    "retryable": false,
    "next_action": "execute",
    "provider_fallback": false
  }
}
```

A probe can return `400` for invalid input, `404` for an unknown capability, `429` when rate limited, or `502`/`504` when the probe service is unavailable. See the [focused Probe reference](api-reference/probe.md) for the exact schema and all responses.

## 4. Call a capability

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
    "q": "London"
  },
  "max_response_size": 20480
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `tool_id` | string | Required overall | Unique id of the tool to execute. Provide it as the query parameter or in this JSON body. |
| `search_id` | string | Recommended | Search id that returned the selected tool |
| `session_id` | string | No | Tracking and pricing-context id; if omitted, the service may use the execution id |
| `model` | string | Recommended for agents | Non-blank model identifier without whitespace or control characters, at most 128 characters, that selected the tool or generated the parameters, such as `gpt-4.1`, `deepseek-v4-pro`, or `claude-sonnet-4` |
| `parameters` | object | Yes | Capability-specific parameters built from the selected current contract returned by Discover or Inspect |
| `max_response_size` | integer | No | Automatic inline-delivery limit measured from serialized `result.data` in UTF-8 bytes; default `20480`, `-1` means unlimited. An explicit `full` takes precedence over a finite value; `summary` ignores it. |
| `respond_with` | string | No | Delivery mode: omit it for compatibility auto-delivery; explicit `full` forces complete inline `result.data`; `fields:<JSONPath,...>` projects first and then applies the size limit; `summary` returns statistics or preserves a data/overflow fallback. |

Invalid tool parameters or projections return HTTP `422` with field-level `details`; authentication failures return the standard API error object instead of a successful Call or empty Search shape.

Delivery precedence:

| `respond_with` | `max_response_size` | Delivery |
| --- | --- | --- |
| Omitted | Omitted / positive | Inline within the default / requested limit; otherwise a truncated preview and full-content URL |
| Omitted | `-1` | Complete inline data |
| `full` | Any value or omitted | Complete inline `result.data`; a finite size value does not downgrade it |
| `fields:...` | Omitted / positive / `-1` | Project first, then apply the default / requested / unlimited inline rule |
| `summary` | Any value or omitted | Statistics, lossless data, or complete overflow fallback |

If explicit `full` exceeds the platform hard safety limit, the request fails with `error_code: response_too_large`; it is never silently converted into an overflow envelope. Binary attachments keep their attachment delivery contract and are not implicitly base64-encoded into JSON.

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
  "cost": 5,
  "remaining_credits": 990
}
```

### Response fields

| Field | Type | Description |
| --- | --- | --- |
| `execution_id` | string | Unique id for this execution. Replace sample `exec_...` values with ids returned by your response. |
| `result` | object | Tool result payload. Compatibility auto-delivery and fields projection may use the overflow shape below; successful explicit `full` always includes `result.data`. |
| `success` | boolean | Whether the tool execution succeeded. Do not infer final charge outcome from this field alone. |
| `error_message` | string/null | Error detail when `success` is false. |
| `execution_time` | number | Execution elapsed time in seconds. This is the legacy execute response timing field. |
| `elapsed_time_ms` | number | Execution elapsed time in milliseconds when available. |
| `billing` | object | Compact pre-settlement billing statement when available. |
| `cost` | number | Legacy/pre-settlement cost signal when available. |
| `remaining_credits` | number/null | Remaining account credits when available. |

Summary mode preserves at least one usable payload: a `summary` object, lossless `data`, or `truncated_content` together with `full_content_file_url`. These fields may coexist. Neither statistics nor a URL is guaranteed by the mode alone. Check `success` first, then field availability; failed summary calls retain an empty `data` object. Optional metadata includes `content_schema` and `message`. Use any signed URL exactly as returned.

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
| Provider failure | Parameters are accepted but upstream returns an HTTP/provider error. | Check `error_message`; use usage audit when the structured `reason_code` is needed. | Retry when appropriate, choose another provider, or share `execution_id` with support. |

When contacting support, include `execution_id`, `search_id`, `session_id`, `tool_id`, and, for agent clients, `model`. These fields make it possible to tell whether the failure came from search ranking, tool selection, parameter generation, local validation, or the third-party provider.

### Reconcile an uncertain Call

```text
GET /tools/executions/by-idempotency-key?key={original_idempotency_key}
```

When a paid Call loses its HTTP response, query this read-only endpoint with the original `Idempotency-Key`. It never authorizes another provider execution. If the selected settlement path cannot provide durable recovery, the original Call is rejected with `409 idempotency_key_unsupported` before provider dispatch. The response uses the standard API envelope; `data.status` is `pending`, `completed`, or `unavailable`. A completed response contains the original recoverable Call in `data.response`. `unavailable` means the execution is known but its full result cannot be reproduced safely, for example after a short-lived overflow download URL expired.

## Long tool responses

When `respond_with` is omitted, or after a `fields:...` projection, exceeding the effective `max_response_size` may replace `data` with the overflow fields below. This shape is never a successful response to explicit `respond_with: "full"`.

```json
{
  "result": {
    "message": "Result content is too long. Use truncated_content or download full_content_file_url.",
    "full_content_file_url": "https://oss.qveris.ai/tool_result_cache/result.json?Expires=1700007200&Signature=example",
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
| `full_content_file_url` | Temporary signed HTTPS URL for downloading the full content directly from QVeris object storage. Use it exactly as returned; do not rewrite it or assume it shares the API origin. The link expires. |
| `message` | LLM-safe explanation of truncation |
| `content_schema` | JSON schema for the full content when available |

## 5. Usage audit — final request status

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

## 6. Credits ledger — final balance movements

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

The QVeris Public OpenAPI document is available as stable [JSON](https://qveris.ai/openapi.json) and [YAML](https://qveris.ai/openapi.yaml), with versioned [JSON](https://qveris.ai/openapi/v1.json) and [YAML](https://qveris.ai/openapi/v1.yaml) URLs for pinned integrations. It includes request bodies, response schemas, and examples for every published operation. Legacy-compatibility fixtures remain available from the [projection fixtures](https://qveris.ai/openapi/qveris-public-api.projection-fixtures.json).
