# Explainable Routing Recipe

Use this recipe to make a **transparent, cost-aware capability choice**: discover several candidates, compare them on the routing signals QVeris returns — `why_recommended`, `expected_cost`, and quality `stats` (success rate, latency) — then select one and explain the decision before spending credits.

For provider comparison, Inspect every candidate when current scope or a complete contract must be confirmed; a Discover summary is not confirmation. Probe every candidate when the comparison requires a current quote. Reuse may preserve an exact route, never business parameters or results: build parameters from the current request, and make a fresh Call for current, latest, today, or other time-sensitive data.

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

Discover candidates, save the response, and inspect every candidate that will participate in the comparison:

```bash
qveris discover "public company stock quote and market data API" --limit 5 --json > /tmp/qveris-discovered.json
search_id="$(jq -r '.search_id' /tmp/qveris-discovered.json)"
tool_ids=()
while IFS= read -r tool_id; do tool_ids+=("$tool_id"); done < <(jq -r '.results[].tool_id' /tmp/qveris-discovered.json)
qveris inspect "${tool_ids[@]}" --discovery-id "$search_id" --json > /tmp/qveris-inspected.json
```

Compare and select using the current contract, cost, and quality fields in `/tmp/qveris-inspected.json`; use the matching Discover-only `why_recommended` value only to explain the original ranking. If a required comparison signal is missing, do not guess. Probe every candidate first if the decision requires a current cost quote. Then call the selected capability with the original `search_id`:

```bash
qveris call <selected-tool-id> --discovery-id "$search_id" --params '{"symbol":"AAPL"}' --json
```

After a call returns an `execution_id`, audit the final charge (usage defaults to a summary):

```bash
qveris usage --execution-id "exec_..." --json
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
