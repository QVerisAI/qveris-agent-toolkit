#!/usr/bin/env bash
# You.com Web Search Recipe - Runnable Example
#
# Fails closed: only executes on a capability whose provider is You.com.
# If You.com is not registered with QVeris yet, the script exits before
# making any paid call.

set -euo pipefail

echo "=== You.com Web Search via QVeris ==="
echo

# Check for required API key
if [[ -z "${QVERIS_API_KEY:-}" ]]; then
    echo "Error: QVERIS_API_KEY environment variable is required"
    echo "Get your API key at: https://qveris.ai/account?page=api-keys"
    exit 1
fi

# Verify QVeris CLI is available
if ! command -v qveris &> /dev/null; then
    echo "Installing QVeris CLI..."
    npm install -g @qverisai/cli
fi

qv=(qveris)

echo "🔍 Discovering You.com web search capabilities..."
search_result=$("${qv[@]}" discover "You.com web search API" --limit 15 --json 2>/dev/null || {
    echo "Error: Failed to discover capabilities. Check your QVERIS_API_KEY."
    exit 1
})

search_id=$(jq -r '.search_id' <<<"$search_result")
echo "Search ID: $search_id"

# Show available candidates
echo
echo "📋 Candidate capabilities:"
jq -r '.results[] | "  • \(.name) by \(.provider_name // "Unknown")"' <<<"$search_result"

# Select the You.com capability, if one is registered. Never fall back to
# another provider: this recipe is specifically for You.com search.
youcom_tool=$(jq -r '
    [.results[] | select((.provider_name // "") | test("you[.]?com"; "i"))] | first
' <<<"$search_result")

if [[ -z "$youcom_tool" || "$youcom_tool" == "null" ]]; then
    echo
    echo "❌ No You.com capability is currently registered with QVeris."
    echo "Provider onboarding is handled by the QVeris team — see the README"
    echo "for the process. Not making any paid call to another provider."
    exit 0
fi

tool_id=$(jq -r '.tool_id' <<<"$youcom_tool")
tool_name=$(jq -r '.name' <<<"$youcom_tool")
tool_provider=$(jq -r '.provider_name' <<<"$youcom_tool")

echo
echo "🛠️  Selected: $tool_name by $tool_provider"
echo "Tool ID: $tool_id"

# Inspect the capability and show its declared parameter schema
echo
echo "🔎 Inspecting capability details..."
inspect_result=$("${qv[@]}" inspect "$tool_id" --search-id "$search_id" --json)
echo "$inspect_result" | jq -r '.results[0] | "Parameters: \([.params[]? | .name] | join(", ") // "None specified")"'

# Build params from the declared schema so we only send fields this tool
# accepts (tools use different names, e.g. "q" vs "query"; only include
# "count" when the capability declares it).
param_names=$(jq -r '[.results[0].params[]?.name] | join(" ")' <<<"$inspect_result")
query_param="query"
if [[ "$param_names" == *" q "* || "$param_names" == "q" || "$param_names" == "q "* || "$param_names" == *" q" ]]; then
    if [[ "$param_names" != *"query"* ]]; then
        query_param="q"
    fi
fi
params="{\"$query_param\":\"latest AI breakthroughs 2026\"}"
if [[ "$param_names" == *"count"* ]]; then
    params="${params%\}},\"count\":3}"
fi

echo
echo "🌐 Searching: \"latest AI breakthroughs 2026\""
execution=$("${qv[@]}" call "$tool_id" \
    --search-id "$search_id" \
    --params "$params" \
    --json)

execution_id=$(jq -r '.execution_id' <<<"$execution")
echo "Execution ID: $execution_id"

# Show search results (truncated for readability)
echo "Results:"
jq -r '.result.results[]? | "  • \(.title // "No title"): \(.url // .link // "No URL")"' <<<"$execution" | head -3

# Audit the charge for this execution. The summary object carries the totals.
echo
echo "📊 Usage for this execution..."
"${qv[@]}" usage --summary --execution-id "$execution_id" --json \
    | jq -r '"Total events: \(.summary.total_events // 0), Credits used: \(.summary.actual_amount_credits // 0)"'

echo
echo "✅ You.com web search recipe completed successfully!"
echo "💡 Note: this recipe only runs on a You.com capability; if You.com is"
echo "   not registered with QVeris yet, it exits before any paid call."
