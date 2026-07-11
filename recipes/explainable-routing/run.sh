#!/usr/bin/env bash
#
# Explainable routing: discover candidates, pick one with a transparent,
# cost-aware rule, and explain the choice before spending credits.
#
# The rule below picks the most reliable capability among the cheapest tier
# (expected_cost within 1.5x of the minimum). Discovery is free; the optional
# call is gated behind RUN_QVERIS_CALLS=1.
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

echo "Candidates (why_recommended / expected_cost / success_rate):"
jq -r '.results[]
  | "  \(.tool_id)\tcost=\(.expected_cost // "n/a")\tsuccess=\(.stats.success_rate // "n/a")\twhy=\(.why_recommended // "n/a")"' \
  <<<"$discovered"

# Routing rule: among candidates within 1.5x of the cheapest estimate, take the
# most reliable one. This is the choice we can explain and defend.
choice="$(jq -c '
  .results as $r
  | ($r | map((.expected_cost // 0 | tonumber? // 0)) | min) as $mincost
  | [ $r[] | select((.expected_cost // 0 | tonumber? // 0) <= ($mincost * 1.5)) ]
  | sort_by(.stats.success_rate // 0) | reverse | .[0] // empty' <<<"$discovered")"

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
