#!/usr/bin/env bash
#
# Discover -> inspect -> call -> audit, scripted with the QVeris CLI and jq.
#
# Discovery and inspection are free. The call step is gated behind
# RUN_QVERIS_CALLS=1 because it may consume credits.
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
tool_id="$(jq -r '.results[0].tool_id // empty' <<<"$discovered")"

if [[ -z "$tool_id" ]]; then
  echo "No capabilities matched: $query"
  exit 0
fi

echo "search_id: $search_id"
echo "selected:  $tool_id"

# 2. Inspect — read the current parameter schema before spending anything.
#    Pass --discovery-id so the inspection is attributed to this discovery.
#    inspect returns a search-shaped envelope; the tool is under .results[0].
"${qv[@]}" inspect "$tool_id" --discovery-id "$search_id" --json \
  | jq '.results[0] | {tool_id, name, expected_cost, success_rate: .stats.success_rate}'

if [[ "${RUN_QVERIS_CALLS:-}" != "1" ]]; then
  echo "Set RUN_QVERIS_CALLS=1 to execute the selected capability."
  exit 0
fi

# 3. Call — execute the capability, then audit the settled charge.
result="$("${qv[@]}" call "$tool_id" --discovery-id "$search_id" --params '{"symbol":"AAPL"}' --json)"
execution_id="$(jq -r '.execution_id' <<<"$result")"
echo "execution_id: $execution_id"

# 4. Audit — usage reflects the final, settled charge (pre-call estimates can differ).
#    --mode search filters to this execution; the records come back under .items.
"${qv[@]}" usage --mode search --execution-id "$execution_id" --json | jq '{matched_records, items}'
