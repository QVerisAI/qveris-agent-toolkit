#!/usr/bin/env bash
#
# Conditional Discover -> Call (with Inspect fallback) -> audit, using the CLI and jq.
#
# Discovery and inspection are free. The call step is gated behind
# RUN_QVERIS_CALLS=1 because it may consume credits.
# For provider comparison, Inspect every candidate when current scope or a complete contract must be confirmed; a Discover summary is not confirmation. Probe every candidate when the comparison requires a current quote.
# Reuse may preserve an exact route, never business parameters or results: build parameters from the current request, and make a fresh Call for current, latest, today, or other time-sensitive data.
#
#   QVERIS_API_KEY=sk-... ./discover-inspect-call.sh
#   QVERIS_API_KEY=sk-... RUN_QVERIS_CALLS=1 ./discover-inspect-call.sh
#
set -euo pipefail

# Support both an installed `qveris` and an override like `npx -y @qverisai/cli`.
IFS=" " read -r -a qv <<<"${QVERIS_BIN:-qveris}"
query="${1:-public company stock quote and market data API}"

if [[ -z "${QVERIS_API_KEY:-}" ]]; then
  echo "Set QVERIS_API_KEY to run this example. https://qveris.ai/account?page=api-keys"
  exit 0
fi

# 1. Discover — capture the whole response so we can reuse its search_id.
discovered="$("${qv[@]}" discover "$query" --limit 5 --json)"
search_id="$(jq -r '.search_id' <<<"$discovered")"
selected="$(jq -c '[.results[] | select(.params != null and ([.params[].name] | index("symbol")) != null and (([.params[] | select(.required == true) | .name] - ["symbol"]) | length) == 0)] | first // empty' <<<"$discovered")"

if [[ "$(jq -r '.results | length' <<<"$discovered")" == "0" ]]; then
  echo "No capabilities matched: $query"
  exit 0
fi

echo "search_id: $search_id"

# 2. Inspect only when compact discovery omitted a compatible contract.
if [[ -z "$selected" ]]; then
  tool_ids=()
  while IFS= read -r id; do tool_ids+=("$id"); done < <(jq -r '.results[:3][].tool_id' <<<"$discovered")
  inspected="$("${qv[@]}" inspect "${tool_ids[@]}" --discovery-id "$search_id" --json)"
  selected="$(jq -c '[.results[] | select(.params != null and ([.params[].name] | index("symbol")) != null and (([.params[] | select(.required == true) | .name] - ["symbol"]) | length) == 0)] | first // empty' <<<"$inspected")"
fi

if [[ -z "$selected" ]]; then
  echo "No candidate exposed a current parameter contract with a symbol field."
  exit 1
fi

tool_id="$(jq -r '.tool_id' <<<"$selected")"
echo "selected:  $tool_id"
jq '{tool_id, name, expected_cost, success_rate: .stats.success_rate}' <<<"$selected"

if [[ "${RUN_QVERIS_CALLS:-}" != "1" ]]; then
  echo "Set RUN_QVERIS_CALLS=1 to execute the selected capability."
  exit 0
fi

# 3. Call — build current values from this request, then audit the settled charge.
result="$("${qv[@]}" call "$tool_id" --discovery-id "$search_id" --params '{"symbol":"AAPL"}' --json)"
execution_id="$(jq -r '.execution_id' <<<"$result")"
echo "execution_id: $execution_id"

# 4. Audit — usage reflects the final, settled charge (pre-call estimates can differ).
#    --mode search filters to this execution; the records come back under .items.
"${qv[@]}" usage --mode search --execution-id "$execution_id" --json | jq '{matched_records, items}'
