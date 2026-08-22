# You.com Web Search Recipe

Use this recipe to discover, inspect, call, and audit You.com web search capabilities through QVeris.

## Quickstart

```bash
export QVERIS_API_KEY="sk-..."
qveris init --query "web search API" --params '{"query":"latest AI breakthroughs 2026","count":5}' --json
```

## CLI

Use the first-call flow when you want QVeris to discover, inspect, select, and call a You.com web search capability in one command:

```bash
qveris init \
  --query "web search API" \
  --params '{"query":"latest AI breakthroughs 2026","count":5}' \
  --max-size 20480 \
  --json
```

### Discover You.com capabilities specifically

```bash
# Find You.com search capabilities
qveris discover "You.com web search API" --json

# Alternative: search for web search and filter results
qveris discover "web search API" --json | jq '.results[] | select(.provider | test("you.com"; "i"))'
```

### Step-by-step workflow

```bash
# 1. Discover web search capabilities
search_result=$(qveris discover "web search API" --json)
search_id=$(echo "$search_result" | jq -r '.search_id')
tool_id=$(echo "$search_result" | jq -r '.results[0].tool_id')

# 2. Inspect the capability details
qveris inspect "$tool_id" --search-id "$search_id" --json

# 3. Execute a search
execution=$(qveris call "$tool_id" \
  --search-id "$search_id" \
  --params '{"query":"latest developments in quantum computing","count":10}' \
  --json)

# 4. Extract execution ID for audit
execution_id=$(echo "$execution" | jq -r '.execution_id')

# 5. Audit the call (optional)
qveris usage --execution-id "$execution_id" --json
qveris ledger --limit 5 --json
```

## Python SDK

```python
import asyncio
from qveris import QverisClient

async def search_web(query: str, count: int = 5) -> None:
    """Search the web using You.com through QVeris capability routing."""
    client = QverisClient()
    try:
        # Discover web search capabilities
        discovered = await client.discover("web search API", limit=10)
        if not discovered.results:
            print("No web search capabilities found.")
            return
        
        # Find You.com capability or use first available
        youcom_tool = None
        for tool in discovered.results:
            if "you.com" in tool.provider.lower():
                youcom_tool = tool
                break
        
        selected_tool = youcom_tool or discovered.results[0]
        print(f"Using: {selected_tool.name} by {selected_tool.provider}")
        
        # Inspect the capability (optional)
        inspected = await client.inspect(
            selected_tool.tool_id, 
            search_id=discovered.search_id
        )
        
        # Execute the search
        result = await client.call(
            selected_tool.tool_id, 
            {"query": query, "count": count}, 
            search_id=discovered.search_id
        )
        
        print("Search Results:")
        print(result.model_dump_json(indent=2))
        
        # Audit the call (optional)
        usage = await client.usage(execution_id=result.execution_id, summary=True)
        print(f"Usage: {usage.model_dump_json(indent=2)}")
        
    finally:
        await client.close()

async def main() -> None:
    await search_web("latest AI breakthroughs 2026", count=8)

if __name__ == "__main__":
    asyncio.run(main())
```

Save this as `youcom_search.py` and run:

```bash
pip install qveris
python youcom_search.py
```

## MCP Integration

You can also use this recipe through QVeris MCP server in Claude Desktop, Cursor, or any MCP-compatible client:

### Setup

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "qveris": {
      "command": "npx",
      "args": ["@qverisai/mcp"],
      "env": {
        "QVERIS_API_KEY": "sk-your-key-here"
      }
    }
  }
}
```

### Usage in Claude Desktop

```
I need to search for the latest developments in quantum computing. Use QVeris to discover a web search capability and execute a search with the query "latest quantum computing breakthroughs 2026".
```

Claude will use the QVeris MCP server to:
1. Discover web search capabilities
2. Inspect parameter requirements  
3. Execute the search with your query
4. Return formatted results with citations

## Use Cases

### Research Current Events
```bash
qveris init --query "news search API" --params '{"query":"breaking news technology","count":10}' --json
```

### Product Research
```bash
qveris init --query "web search API" --params '{"query":"iPhone 16 Pro reviews 2026","count":5}' --json
```

### Technical Documentation
```bash
qveris init --query "web search API" --params '{"query":"React 19 new features documentation","count":8}' --json
```

### Trending Topics
```bash
qveris init --query "web search API" --params '{"query":"trending topics AI research","count":15}' --json
```

## Advanced Configuration

### With You.com API Key

If you have a You.com API key for enhanced features:

```bash
export YDC_API_KEY="your-you-com-api-key"
qveris init --query "You.com authenticated web search" --params '{"query":"advanced AI research papers","count":20}' --json
```

### Multiple Search Providers

Compare results from different search providers:

```bash
# Discover all web search capabilities
qveris discover "web search API" --json > search_providers.json

# Test multiple providers
for provider_id in $(cat search_providers.json | jq -r '.results[].tool_id'); do
  echo "Testing provider: $provider_id"
  qveris call "$provider_id" --params '{"query":"test query","count":3}' --json
done
```

## Billing and Credits

- **Discovery**: Free through QVeris
- **Execution**: Priced per You.com API call through QVeris billing
- **Audit**: Check exact charges with `qveris usage` and `qveris ledger`

You.com search through QVeris typically costs 1-5 credits per search, depending on result count and search complexity. Free-tier searches may also be available.

## Troubleshooting

### No You.com capabilities found

```bash
# Check all available search providers
qveris discover "web search" --json | jq '.results[] | {name: .name, provider: .provider}'

# If You.com isn't listed, it may not be registered yet
# Use any available web search provider as fallback
```

### API Key Issues

```bash
# Verify QVeris API key
qveris auth status

# Test with minimal search
qveris init --query "simple web search" --params '{"query":"test"}' --json
```

### Rate Limits

QVeris handles rate limiting automatically. If you hit limits:

```bash
# Check usage and remaining credits
qveris usage --summary --json
qveris ledger --limit 10 --json
```

## Contributing

Found You.com capabilities not working as expected? This recipe is part of the QVeris ecosystem. Capability registration and updates happen through the QVeris platform.

For recipe improvements:
1. Fork the QVeris agent toolkit
2. Update this recipe's documentation or examples  
3. Open a PR against the main repository

## Related Recipes

- [Finance Research](../finance-research/README.md) - Market data discovery
- [Data Analysis](../data-analysis/README.md) - Analytics capabilities
- [Developer Automation](../developer-automation/README.md) - Code and deployment tools