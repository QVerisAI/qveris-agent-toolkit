#!/usr/bin/env bash
# You.com Web Search Recipe - Runnable Example

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

echo "🔍 Discovering web search capabilities..."
search_result=$(qveris discover "web search API" --json 2>/dev/null || {
    echo "Error: Failed to discover capabilities. Check your QVERIS_API_KEY."
    exit 1
})

search_id=$(echo "$search_result" | jq -r '.search_id')
echo "Search ID: $search_id"

# Show available capabilities
echo
echo "📋 Available web search capabilities:"
echo "$search_result" | jq -r '.results[] | "  • \(.name) by \(.provider)"'

# Select first web search capability  
tool_id=$(echo "$search_result" | jq -r '.results[0].tool_id')
tool_name=$(echo "$search_result" | jq -r '.results[0].name')
tool_provider=$(echo "$search_result" | jq -r '.results[0].provider')

echo
echo "🛠️  Selected: $tool_name by $tool_provider"
echo "Tool ID: $tool_id"

# Inspect the capability
echo
echo "🔎 Inspecting capability details..."
inspect_result=$(qveris inspect "$tool_id" --search-id "$search_id" --json)
echo "$inspect_result" | jq -r '.results[0] | "Parameters: \(.parameters // "None specified")"'

# Execute search queries
queries=(
    "latest AI breakthroughs 2026"
    "quantum computing news this week"  
    "best programming languages 2026"
)

for query in "${queries[@]}"; do
    echo
    echo "🌐 Searching: \"$query\""
    
    execution=$(qveris call "$tool_id" \
        --search-id "$search_id" \
        --params "{\"query\":\"$query\",\"count\":3}" \
        --json)
    
    execution_id=$(echo "$execution" | jq -r '.execution_id')
    echo "Execution ID: $execution_id"
    
    # Show search results (truncated for readability)
    echo "Results:"
    echo "$execution" | jq -r '.result.results[]? | "  • \(.title // "No title"): \(.url // .link // "No URL")"' | head -3
    
    # Brief pause between searches
    sleep 1
done

echo
echo "📊 Checking usage summary..."
qveris usage --summary --json | jq -r '"Total calls: \(.total_requests // 0), Credits used: \(.total_credits // 0)"'

echo
echo "✅ You.com web search recipe completed successfully!"
echo "💡 Tip: Use 'qveris discover \"You.com\"' to find You.com-specific capabilities"