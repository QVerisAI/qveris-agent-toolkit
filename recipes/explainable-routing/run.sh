#!/usr/bin/env bash
#
# Explainable routing: discover candidates, pick one with a transparent,
# cost-aware rule, and explain the choice before spending credits.
#
# The rule below picks the most reliable capability among the cheapest tier
# (expected_cost within 1.5x of the minimum). Discovery is free; the optional
# call is gated behind RUN_QVERIS_CALLS=1.
#
# For provider comparison, Inspect every candidate when current scope or a complete contract must be confirmed; a Discover summary is not confirmation.
# Probe every candidate when the comparison requires a current quote.
# Reuse may preserve an exact route, never business parameters or results: build parameters from the current request, and make a fresh Call for current, latest, today, or other time-sensitive data.
#
#   QVERIS_API_KEY=sk-... ./run.sh
#   QVERIS_API_KEY=sk-... RUN_QVERIS_CALLS=1 ./run.sh
#
set -euo pipefail

# Support both an installed `qveris` and an override like `npx -y @qverisai/cli`.
IFS=" " read -r -a qv <<<"${QVERIS_BIN:-qveris}"
query="${1:-public company stock quote and market data API}"

if [[ -z "${QVERIS_API_KEY:-}" ]]; then
  echo "Set QVERIS_API_KEY to run this recipe. https://qveris.ai/account?page=api-keys"
  exit 0
fi

discovered="$("${qv[@]}" discover "$query" --limit 5 --json)"
search_id="$(jq -r '.search_id' <<<"$discovered")"

tool_ids=()
while IFS= read -r tool_id; do
  tool_ids+=("$tool_id")
done < <(jq -r '(.results // [])[].tool_id' <<<"$discovered")
if [[ "${#tool_ids[@]}" -eq 0 ]]; then
  echo "No capabilities matched: $query"
  exit 0
fi

inspected="$("${qv[@]}" inspect "${tool_ids[@]}" --discovery-id "$search_id" --json)"
# Contract, cost, and quality fields come from Inspect. Merge only the
# Discover-only ranking explanation by tool_id so it cannot replace current
# comparison metadata.
candidates="$(jq -cn --argjson discovered "$discovered" --argjson inspected "$inspected" '
  ($discovered.results // []) as $discovered_results
  | {results: [$discovered_results[] as $ranked
      | [($inspected.results // [])[] | select(.tool_id == $ranked.tool_id)][0] as $current
      | select($current != null)
      | $current + {why_recommended: $ranked.why_recommended}]}')"

echo "Candidates (why_recommended / expected_cost / success_rate):"
jq -r '(.results // [])[]
  | "  \(.tool_id)\tcost=\(.expected_cost // "n/a")\tsuccess=\(.stats.success_rate // "n/a")\twhy=\(.why_recommended // "n/a")"' \
  <<<"$candidates"

# Routing rule: among candidates within 1.5x of the cheapest estimate, take the
# most reliable one. This is the choice we can explain and defend. Guard against
# a missing/empty results array so an empty match set exits cleanly, not crashes.
choice="$(jq -c '
  [(.results // [])[]
    | (try (.expected_cost | tonumber) catch null) as $cost
    | (if (.stats.success_rate | type) == "number" then .stats.success_rate else null end) as $success
    | select($cost != null and $success != null)
    | . + {_routing_cost: $cost, _routing_success: $success}] as $eligible
  | if ($eligible | length) == 0 then empty
    else
      ($eligible | map(._routing_cost) | min) as $mincost
      | [$eligible[] | select(._routing_cost <= ($mincost * 1.5))]
      | sort_by(._routing_success) | reverse | .[0]
      | del(._routing_cost, ._routing_success)
    end // empty' <<<"$candidates")"

if [[ -z "$choice" ]]; then
  echo "No capabilities matched: $query"
  exit 0
fi

tool_id="$(jq -r '.tool_id' <<<"$choice")"
echo ""
echo "Chosen: $tool_id"
jq -r '"Because: \(.why_recommended // "highest reliability in the cheapest tier") " +
       "(expected_cost=\(.expected_cost // "n/a"), success_rate=\(.stats.success_rate // "n/a"))"' <<<"$choice"

if [[ "${RUN_QVERIS_CALLS:-}" != "1" ]]; then
  echo "Set RUN_QVERIS_CALLS=1 to execute the chosen capability."
  exit 0
fi

"${qv[@]}" call "$tool_id" --discovery-id "$search_id" --params '{"symbol":"AAPL"}' --json \
  | jq '{execution_id, success, billing: .billing.summary}'
