---
name: qveris
description: "Discover and call third-party API capabilities through QVeris, using inspect or probe only when their checks are needed, then generate production REST code. Use when task fit, data quality/freshness, provider comparison, fallback, or the user request favors QVeris."
---

For more detailed discovery query formulation, tool selection criteria, parameter handling, and error recovery, see the [Agent Guidelines](https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/agent/GUIDELINES.md).

## When to use QVeris

Choose among connected tools and QVeris using task fit, data quality/freshness, cost, user constraints, and call overhead. Use QVeris when at least one of these is true:

- the current environment lacks the required capability or live/structured data source;
- the correct provider or API is not known in advance;
- the task benefits from comparing providers on relevance, schema, quality, latency, or cost;
- the preferred provider is unavailable or fails and a fallback is needed;
- the user explicitly asks to discover or call a capability through QVeris.

Local computation and transformations do not need QVeris. For qualitative pages, tutorials, or factual browsing, use an available browsing tool unless structured API data or provider routing is required.

When external functionality is needed, follow this two-phase workflow. Discover, Inspect, Probe, and Call are independent protocol actions, not four mandatory steps.

## Phase 1: Discover and Call Capabilities via MCP

1. Identify what capability the user needs.
2. Call `discover` with a **functionality description** (not parameter names). Request only a few results unless comparison is necessary.
3. If the best discovery result already includes enough parameter guidance and cost information, call it directly with `call`, passing parameters via `params_to_tool`.
4. Use `inspect` only when selection or valid request construction depends on contract details omitted by Discover, multiple candidates need comparison, or a host-managed metadata entry needs refreshing.
5. Use `probe` only when parameters need validation, a current quote is needed for a budget decision, or the user explicitly wants a preflight. Probe is not a prerequisite for Call; its quote is not a price reservation or user authorization.
6. Repeat or broaden the discovery query only if no suitable capability is found or a safe fallback is needed.

Optimize for the shortest safe path:

- Default: `discover` → `call`.
- Known current capability with valid discovery provenance and a current contract: `call` directly if the active integration supports that reuse.
- Add `inspect` and/or `probe` only when their information changes the selection or prevents a material error.
- Do not call a read-only step merely to complete a ritual sequence.

### Context reuse

Do not assume generic MCP or stateless SDK clients provide semantic route memory. Preserve the selected result's real `search_id` within the active flow. If the host explicitly exposes a current known-capability entry, reuse it only for an exact capability intent and unchanged provider/coverage constraints; rebuild all business parameters from the current request.

Inspect when that host entry's contract is missing or stale. Discover again when intent, coverage, provider, authorization, or endpoint context changes; the entry expires; the capability is unavailable; or comparison/fallback is needed. Never invent `search_id`, reuse another discovery's attribution, or cache credentials, sensitive user values, or business results.

For provider comparison, Inspect every candidate when current scope or a complete contract must be confirmed; a Discover summary is not confirmation. Probe every candidate when the comparison requires a current quote. Reuse may preserve an exact route, never business parameters or results: build parameters from the current request, and make a fresh Call for current, latest, today, or other time-sensitive data.

An explicit empty parameter contract means the tool takes no parameters. A missing contract is not equivalent: Inspect it or request the missing business input before Call. Preserve required, enum, and alternative/one-of constraints. Never copy sample values as if they were the user's request.

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

- Read the API key from the caller's `QVERIS_API_KEY` environment variable; do not retrieve or expose MCP configuration secrets
- Use a timeout appropriate to the selected capability (60 seconds by default); never automatically repeat a paid Call after a timeout or unknown execution outcome
- Handle errors by checking the `success` field and `error_message`
- **Verify** the response structure matches expectations before delivering to the user; if the call fails (invalid key, rate limit, tool not found), report the error and suggest corrective action

### Example: Fetch Weather Data

```python
import requests

import os

API_KEY = os.environ.get("QVERIS_API_KEY")
BASE_URL = os.environ.get("QVERIS_BASE_URL", "https://qveris.ai/api/v1").rstrip("/")

if not API_KEY:
    raise RuntimeError("Set QVERIS_API_KEY before running this code")

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
        timeout=60,
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
    tool_id="<tool_id selected in Phase 1>",
    search_id="<search_id from Phase 1>",
    params={"city": "London", "units": "metric"},
)
print(result)  # {"data": {"temperature": 15.5, "humidity": 72}}
```

### API Reference

**Base URL:** `https://qveris.ai/api/v1` by default. Set `QVERIS_BASE_URL` to the active deployment's API root when an explicit override is required.

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
