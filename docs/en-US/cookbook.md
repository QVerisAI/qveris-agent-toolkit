# QVeris Cookbook

These recipes use the shortest safe path: Discover -> Call when the current result already contains a complete contract, with Inspect or Probe added only when the task needs them. Replace sample ids such as `srch_...`, `exec_...`, and `led_...` with ids returned by your own API responses.

For provider comparison, Inspect every candidate when current scope or a complete contract must be confirmed; a Discover summary is not confirmation. Probe every candidate when the comparison requires a current quote. Reuse may preserve an exact route, never business parameters or results: build parameters from the current request, and make a fresh Call for current, latest, today, or other time-sensitive data.

## Recipe 1: Add weather context to an agent answer

Use this when a user asks for current weather and your agent needs a reliable external capability.

This fixed recipe queries the exact tool ID. Its Discover response contains the required `q` contract, so it can proceed directly to Call. Use a natural-language capability query when you want QVeris to rank alternative tools dynamically.

```bash
export QVERIS_BASE_URL="https://qveris.ai/api/v1"
export QVERIS_SESSION_ID="weather-$(date +%s)"

curl -sS "$QVERIS_BASE_URL/search" \
  -H "Authorization: Bearer $QVERIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"openweathermap.weather.execute.v1","limit":3,"session_id":"'"$QVERIS_SESSION_ID"'"}'
```

Call:

```bash
curl -sS "$QVERIS_BASE_URL/tools/execute?tool_id=openweathermap.weather.execute.v1" \
  -H "Authorization: Bearer $QVERIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "search_id":"srch_01HZX9QK7J3M9T",
    "session_id":"'"$QVERIS_SESSION_ID"'",
    "parameters":{"q":"London"}
  }'
```

Agent handling notes:

- Keep `search_id`, `execution_id`, and `session_id` in your trace.
- Inspect before Call if Discover omits the parameter contract or the contract may be stale. Ask for missing business inputs instead of copying sample values.
- Show a short answer from `result.data`; keep raw JSON in logs or a debug panel.
- Use usage audit if the user asks whether the call was charged.

## Recipe 2: Compare candidates before spending credits

Use this when several providers can satisfy the same request.

```bash
curl -sS "$QVERIS_BASE_URL/search" \
  -H "Authorization: Bearer $QVERIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"company fundamentals API","limit":5,"session_id":"finance-compare"}'
```

Inspect the top candidates:

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

Selection checklist:

- Prefer a matching parameter schema over a higher score.
- Compare `expected_cost` and `billing_rule` before Call.
- Treat `success_rate` and `avg_execution_time_ms` as quality signals, not guarantees.
- Do not bill the user for Discover or Inspect; only Call may consume credits.

## Recipe 3: Handle long responses safely

Use `max_response_size` when the result may be too large for an LLM context.

```bash
curl -sS "$QVERIS_BASE_URL/tools/execute?tool_id=pubmed_refined.search_articles.v1" \
  -H "Authorization: Bearer $QVERIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "search_id":"srch_research_123",
    "session_id":"research-task",
    "parameters":{"query":"engineering theory of evolution","limit":10},
    "max_response_size":1200
  }'
```

When the response is truncated, `result` may include:

```json
{
  "message": "Result content is too long. Use truncated_content or download full_content_file_url.",
  "truncated_content": "{\"query\":\"engineering theory...\"",
  "full_content_file_url": "https://...",
  "content_schema": { "type": "object" }
}
```

Agent handling notes:

- Summarize from `truncated_content` when enough.
- Fetch `full_content_file_url` only when the user task needs the full payload.
- Avoid pasting large raw payloads back into the conversation.

## Recipe 4: Audit a failed call

If `success` is `false`, do not infer charge status from the error alone. Query usage audit by `execution_id`.

```bash
curl -sS "$QVERIS_BASE_URL/auth/usage/history/v2?execution_id=exec_01HZX9R2R4S2E" \
  -H "Authorization: Bearer $QVERIS_API_KEY"
```

Check `charge_outcome`:

- `charged`: final settlement consumed credits.
- `included`: the call was covered by included/free credits or a policy exemption.
- `failed_not_charged`: the failed call did not consume credits.
- `failed_charged_review`: the charge needs review or support handling.
