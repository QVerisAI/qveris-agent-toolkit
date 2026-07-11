#!/usr/bin/env bash
#
# Cost-aware calling: only execute a capability when it fits the budget.
#
# Reads the pre-call `expected_cost` and the account's remaining credits, and
# refuses to call when the estimate exceeds MAX_COST or the balance. This is the
# QVeris differentiator in practice — decide *before* spending.
#
#   QVERIS_API_KEY=sk-... MAX_COST=5 ./budget-guard.sh
#   QVERIS_API_KEY=sk-... MAX_COST=5 RUN_QVERIS_CALLS=1 ./budget-guard.sh
#
set -euo pipefail

# Support both an installed `qveris` and an override like `npx -y @qverisai/cli`.
IFS=" " read -r -a qv <<<"${QVERIS_BIN:-qveris}"
query="${1:-public company stock quote and market data API}"
max_cost="${MAX_COST:-5}"

if [[ -z "${QVERIS_API_KEY:-}" ]]; then
  echo "Set QVERIS_API_KEY to run this example. https://qveris.ai/account?page=api-keys"
  exit 0
fi

discovered="$("${qv[@]}" discover "$query" --limit 5 --json)"
search_id="$(jq -r '.search_id' <<<"$discovered")"
top="$(jq -c '.results[0] // empty' <<<"$discovered")"

if [[ -z "$top" ]]; then
  echo "No capabilities matched: $query"
  exit 0
fi

tool_id="$(jq -r '.tool_id' <<<"$top")"
# expected_cost may be a string or number; coerce to a number, default 0.
expected_cost="$(jq -r '(.expected_cost // 0) | tonumber? // 0' <<<"$top")"
remaining="$("${qv[@]}" credits --json | jq -r '.remaining_credits // 0')"

echo "candidate:      $tool_id"
echo "expected_cost:  $expected_cost credits (cap $max_cost)"
echo "remaining:      $remaining credits"

# Numeric comparisons via jq so float estimates compare correctly.
if jq -e -n --argjson c "$expected_cost" --argjson m "$max_cost" '$c > $m' >/dev/null; then
  echo "Skip: estimate exceeds MAX_COST."
  exit 0
fi
if jq -e -n --argjson c "$expected_cost" --argjson r "$remaining" '$c > $r' >/dev/null; then
  echo "Skip: not enough credits."
  exit 0
fi

if [[ "${RUN_QVERIS_CALLS:-}" != "1" ]]; then
  echo "Within budget. Set RUN_QVERIS_CALLS=1 to execute."
  exit 0
fi

"${qv[@]}" call "$tool_id" --discovery-id "$search_id" --params '{"symbol":"AAPL"}' --json \
  | jq '{execution_id, success, billing: .billing.summary}'
