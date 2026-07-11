#!/usr/bin/env bash
#
# Finance research first-call path: discover -> inspect -> call -> audit for a
# public company market-data capability.
#
# Without RUN_QVERIS_CALLS=1 this does a free discover-only dry run. With it, it
# runs the one-shot `qveris init` first-call flow, which discovers, selects, and
# calls in a single command (and may consume credits).
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

if [[ "${RUN_QVERIS_CALLS:-}" != "1" ]]; then
  echo "Dry run (discover only). Set RUN_QVERIS_CALLS=1 for the full first-call flow."
  "${qv[@]}" discover "$query" --limit 5 --json \
    | jq -r '.results[] | "  \(.tool_id)\tcost=\(.expected_cost // "n/a")"'
  exit 0
fi

# One-shot first call: discover -> inspect -> select -> call in one command.
# init nests its output: selected_tool.tool_id and call.{execution_id,success}.
result="$("${qv[@]}" init --query "$query" --params '{"symbol":"AAPL"}' --max-size 20480 --json)"
execution_id="$(jq -r '.call.execution_id // empty' <<<"$result")"
echo "$result" | jq '{tool_id: .selected_tool.tool_id, execution_id: .call.execution_id, success: .call.success}'

# Audit the settled charge. --mode search filters to this execution; the records
# come back under .items.
if [[ -n "$execution_id" ]]; then
  "${qv[@]}" usage --mode search --execution-id "$execution_id" --json | jq '{matched_records, items}'
fi
