---
name: qveris
description: "Discover, inspect, and call third-party API capabilities via the QVeris MCP server, then generate production code that calls the QVeris REST API for tasks like fetching weather data, stock prices, or public datasets. Use when the user needs to find an external API, integrate a web service, connect to a third-party REST endpoint, or retrieve data from an external source."
---

For discovery query formulation, tool selection criteria, parameter handling, and error recovery, see [Agent Guidelines](../../agent/GUIDELINES.md).

When external functionality is needed, follow this two-phase workflow:

## Phase 1: Discover and Call Capabilities via MCP

1. Identify what tool capability the user needs
2. Call `discover` with a **functionality description** (not parameter names) — limit results to 10
3. Call `inspect` when you need full parameter details, examples, success rate, latency, or billing metadata
4. Call `call` to test a candidate, passing parameters via `params_to_tool`
5. Repeat or broaden the discovery query if no suitable capability is found

Compatibility note: legacy MCP names `search_tools`, `get_tools_by_ids`, and `execute_tool` remain deprecated aliases only. Prefer `discover`, `inspect`, and `call` in all new workflows.

## Billing and Audit

QVeris separates pricing rules, pre-settlement billing, and final settlement:

- `billing_rule` explains how a capability is priced.
- `billing` / `pre_settlement_bill` explains the theoretical charge for a call.
- `usage_history` and `credits_ledger` answer whether credits were actually charged and how the balance changed.

When the user asks whether a failed call was charged, do not infer from `cost` alone. Query `usage_history` with the `execution_id` and inspect `charge_outcome`.

Use context-safe audit patterns:

- Start with `mode: "summary"` for usage or ledger totals.
- Use `mode: "search"` with precise filters such as `execution_id`, `charge_outcome`, `min_credits`, `max_credits`, or a date range.
- Use `mode: "export_file"` for large analysis; read the resulting JSONL file in chunks instead of returning all rows into context.

## Phase 2: Generate Production Code

Once a suitable tool is identified, generate code that calls the QVeris REST API directly. Do **not** reuse the MCP tool-call result — produce standalone code the user can run.

- Read the API key from the MCP server config (`QVERIS_API_KEY`)
- Set a 5-second request timeout
- Handle errors by checking the `success` field and `error_message`
- **Verify** the response structure matches expectations before delivering to the user; if the call fails (invalid key, rate limit, tool not found), report the error and suggest corrective action

### Example: Fetch Weather Data

```python
import requests

import os

API_KEY = os.environ.get("QVERIS_API_KEY", "<QVERIS_API_KEY from MCP config>")
# Auto-detect region from key prefix: sk-cn-xxx → qveris.cn, sk-xxx → qveris.ai
BASE_URL = "https://qveris.cn/api/v1" if API_KEY.startswith("sk-cn-") else "https://qveris.ai/api/v1"

def call_tool(tool_id: str, search_id: str, params: dict) -> dict:
    """Call a QVeris capability and return the result."""
    resp = requests.post(
        f"{BASE_URL}/tools/execute",
        params={"tool_id": tool_id},
        headers={"Authorization": f"Bearer {API_KEY}"},
        json={
            "search_id": search_id,
            "session_id": "",
            "parameters": params,
            "max_response_size": 20480,
        },
        timeout=5,
    )
    resp.raise_for_status()
    try:
        data = resp.json()
    except requests.exceptions.JSONDecodeError:
        raise RuntimeError("Failed to decode API response as JSON.")

    if not data.get("success"):
        raise RuntimeError(f"QVeris error: {data.get('error_message', 'Unknown error')}")

    result = data.get("result")
    if result is None:
        raise RuntimeError("API response is missing the 'result' field.")
    return result

# Usage
result = call_tool(
    tool_id="openweathermap_current_weather",
    search_id="<search_id from Phase 1>",
    params={"city": "London", "units": "metric"},
)
print(result)  # {"data": {"temperature": 15.5, "humidity": 72}}
```

### API Reference

**Base URL:** `https://qveris.ai/api/v1` (global) or `https://qveris.cn/api/v1` (China, key prefix `sk-cn-`)

**Authentication:** `Authorization: Bearer YOUR_API_KEY`

**POST** `/tools/execute?tool_id={tool_id}`

| Field | Type | Description |
|-------|------|-------------|
| `search_id` | string | ID returned by `discover` |
| `session_id` | string | Optional session identifier |
| `parameters` | object | Tool-specific input parameters |
| `max_response_size` | number | Max response bytes (default 20480) |

**Response Fields**

| Field             | Type    | Description                                                 |
|-------------------|---------|-------------------------------------------------------------|
| `execution_id`    | string  | Unique ID for the execution.                                |
| `result`          | object  | Contains the tool's output, typically under a `data` key.   |
| `success`         | boolean | `true` if the call succeeded, `false` otherwise.            |
| `error_message`   | string  | Details of the error if `success` is `false`.               |
| `elapsed_time_ms` | number  | Execution time in milliseconds.                             |
