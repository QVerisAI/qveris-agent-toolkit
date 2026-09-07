---
name: qveris-cli
description: "Use QVeris CLI to discover and call third-party API tools when task fit, data quality/freshness, provider comparison, fallback, or the user request favors QVeris."
---

## Quick first run

New to QVeris? With your `QVERIS_API_KEY` set (create one at [qveris.ai](https://qveris.ai/account?page=api-keys)), `init` is a client-side first-call wizard: auth, discover, inspect, a real call, and exact usage/ledger commands to reconcile billing. It is not a server-side aggregate API.

```bash
export QVERIS_API_KEY="sk-..."
npx @qverisai/cli init
```

Re-run anytime with `--query "..."` to target a different capability, or `--dry-run` to validate without consuming credits. Once you've seen the loop, the commands below are the day-to-day surface.

## Commands

```bash
# Discover tools by capability
qveris discover "weather forecast API" --json --limit 10

# Call after selecting result 1 because its contract matches these exact fields
qveris call 1 --params '{"wfo": "BOU", "x": 50, "y": 30}' --json

# Inspect only when selection/request construction needs missing or stale details
qveris inspect 1 --json

# Probe only for parameter validation or a current quote; it does not reserve a price
qveris probe 1 --params '{"wfo": "BOU", "x": 50, "y": 30}' --checks schema,quote --json

# Validate without consuming credits
qveris call 1 --params '{"wfo": "BOU", "x": 50, "y": 30}' --dry-run --json

# Generate production code snippet (curl/python/js) — only on successful calls
qveris call 1 --params '{"wfo": "BOU", "x": 50, "y": 30}' --codegen curl
```

**Always use `--json`** for structured output.

---

## Response Size

Default: 4KB (TTY) / 20KB (piped/`--json`). Use `--max-size -1` for unlimited.
Large responses are auto-truncated with a download link for the full result.

---

## Session Mechanism

The CLI saves the last Discover ID, query, endpoint, and result summaries for 30 minutes. This supports numeric indices and real discovery attribution; it is not semantic routing memory or a complete schema cache. A new Discover replaces the indices. Use `qveris history --clear` to clear it.

Build parameters from the selected capability's current contract and the user's current request. An explicit empty contract is a zero-parameter tool; an omitted contract requires Inspect. Do not copy sample business values, drop required/enum/one-of constraints, or reuse a previous entity/date value.

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

Choose among connected tools and QVeris by task fit, data quality/freshness, cost, user constraints, and call overhead. Use QVeris when a capability is missing, the provider is unknown, comparison/fallback is needed, or the user requests it. Within Discover results, consider contract fit, provider/coverage constraints, quality, latency, and cost; do not select the first result solely by rank.

---

## Error Recovery

Only retry when the response proves execution did not occur.

1. For a definite validation failure, fix parameters from the current contract or request missing input.
2. Drop optional parameters only if doing so preserves the user's requested meaning.
3. Switch to another compatible result only if provider, coverage, cost, and authorization constraints still hold.

Do not repeat a paid or side-effecting Call after a timeout, network failure, or unknown execution outcome. Report the uncertainty and audit by `execution_id` when available.
