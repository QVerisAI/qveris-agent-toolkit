---
name: qveris
description: "Search for and execute third-party API tools via the QVeris MCP server, then generate production code that calls the QVeris REST API for tasks like fetching weather data, stock prices, or public datasets. Use when the user needs to find an external API, integrate a web service, connect to a third-party REST endpoint, or retrieve data from an external source."
---

When external functionality is needed, follow this two-phase workflow:

## Phase 1: Discover Tools via MCP

1. Identify what tool capability the user needs
2. Call `search_tools` with a **functionality description** (not parameter names) — limit results to 10
3. Call `execute_tool` to test a candidate, passing parameters via `params_to_tool`
4. Repeat or broaden the search if no suitable tool is found

## Phase 2: Generate Production Code

Once a suitable tool is identified, generate code that calls the QVeris REST API directly. Do **not** reuse the MCP tool-call result — produce standalone code the user can run.

- Read the API key from the MCP server config (`QVERIS_API_KEY`)
- Set a 5-second request timeout
- Handle errors by checking the `success` field and `error_message`
- **Verify** the response structure matches expectations before delivering to the user; if the call fails (invalid key, rate limit, tool not found), report the error and suggest corrective action

### Example: Fetch Weather Data

```python
import requests

API_KEY = "<QVERIS_API_KEY from MCP config>"
BASE_URL = "https://qveris.ai/api/v1"

def execute_tool(tool_id: str, search_id: str, params: dict) -> dict:
    """Execute a QVeris tool and return the result."""
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
result = execute_tool(
    tool_id="openweathermap_current_weather",
    search_id="<search_id from Phase 1>",
    params={"city": "London", "units": "metric"},
)
print(result)  # {"data": {"temperature": 15.5, "humidity": 72}}
```

### API Reference

**Base URL:** `https://qveris.ai/api/v1`

**Authentication:** `Authorization: Bearer YOUR_API_KEY`

**POST** `/tools/execute?tool_id={tool_id}`

| Field | Type | Description |
|-------|------|-------------|
| `search_id` | string | ID returned by `search_tools` |
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
