---
name: qveris-cli
description: "Use QVeris CLI to discover and call third-party API tools. Use when you need to find an external API, integrate a web service, or retrieve live data (prices, weather, news, etc)."
---

## Commands

```bash
# Discover tools by capability
qveris discover "weather forecast API" --json --limit 10

# Inspect tool details (optional)
qveris inspect 1 --json

# Call with parameters (use sample_parameters from discover/inspect)
qveris call 1 --params '{"wfo": "BOU", "x": 50, "y": 30}' --json

# Validate without consuming credits
qveris call 1 --params '{"wfo": "BOU", "x": 50, "y": 30}' --dry-run --json
```

**Always use `--json`** for structured output.

---

## Session Mechanism

Results are cached per discover. Use numeric indices immediately.
If you run a new discover, indices reset to reference the new results.

---

## Discover Query Formulation

**Describe tool capability, not data you want.**

| User request | Wrong | Correct |
|-------------|-------|---------|
| "Nvidia earnings" | `"Nvidia earnings"` | `"company earnings report API"` |
| "Beijing weather" | `"Beijing weather today"` | `"weather forecast API"` |
| "BTC price" | `"what is BTC price"` | `"cryptocurrency price API"` |

Always query in English.

---

## Tool Selection

Prefer tools with:
- `success_rate` >= 90%
- `avg_execution_time_ms` < 2000ms
- Higher `final_score`

---

## Error Recovery

1. Fix params based on error message
2. Simplify — drop optional params, use standard values
3. Switch to next tool from discover results

After 3 failures: report what was tried.
