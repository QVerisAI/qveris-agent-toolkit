# Explainable Routing Recipe

Use this recipe to make a **transparent, cost-aware capability choice**: discover several candidates, compare them on the routing signals QVeris returns — `why_recommended`, `expected_cost`, and quality `stats` (success rate, latency) — then select one and explain the decision before spending credits.

This is the QVeris differentiator in practice: your agent does not just take the first result, it can justify *why* it picked a capability and *what it will cost*.

## Quickstart

```bash
export QVERIS_API_KEY="sk-..."
qveris discover "public company stock quote and market data API" --limit 5 --json
```

Each result carries the signals you route on:

- `why_recommended` — plain-language ranking rationale (Discover only)
- `expected_cost` — pre-call credit estimate
- `stats.success_rate` / `stats.avg_execution_time_ms` — recent reliability and latency

## CLI

Discover candidates and print a comparison table with `jq`:

```bash
qveris discover "public company stock quote and market data API" --limit 5 --json \
  | jq -r '.results[]
      | "\(.tool_id)\tcost=\(.expected_cost // "n/a")\tsuccess=\(.stats.success_rate // "n/a")\twhy=\(.why_recommended // "n/a")"'
```

Pick a capability (e.g. the most reliable one whose `expected_cost` is no higher than the top result), then inspect and call it:

```bash
qveris inspect <tool_id> --search-id <search_id> --json
qveris call <tool_id> --search-id <search_id> --params '{"symbol":"AAPL"}' --json
```

After a call returns an `execution_id`, audit the final charge:

```bash
qveris usage --execution-id "exec_..." --summary --json
```

## Python SDK

The runnable example [`packages/python-sdk/examples/explainable_routing.py`](../../packages/python-sdk/examples/explainable_routing.py) discovers candidates, prints a comparison, and applies two transparent cost-aware overrides on top of the backend ranking:

1. **Cost saving** — prefer a much cheaper candidate (≤50% cost) that is no less reliable.
2. **Reliability upgrade** — prefer a candidate that costs no more but is meaningfully more reliable (≥5 points higher success rate).

Both keep spend bounded — it never trades a large cost increase for reliability.

```bash
python explainable_routing.py                 # discovery + explanation only
RUN_QVERIS_CALLS=1 python explainable_routing.py   # also execute the chosen capability
```

Example output:

```text
Selected: Quote
Reason:   chose a more reliable capability at no extra cost — 73.1% vs 59.2% success for the same ~1 credits.
```

The selection helper is small and self-contained — copy `choose(...)` into your own agent loop and adapt the thresholds to your cost/reliability tradeoff.
