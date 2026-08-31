# You.com Web Search Recipe

Use this recipe to discover, inspect, call, and audit You.com web search capabilities through QVeris.

**Important:** this recipe is fail-closed. It only executes searches on a capability whose provider is You.com. If You.com is not yet registered with the QVeris capability network, discovery will not return a You.com tool and the recipe exits before making any paid call (see [Provider onboarding](#provider-onboarding)).

## Quickstart

```bash
export QVERIS_API_KEY="sk-..."
qveris discover "You.com web search API" --json | jq '.results[] | {name, provider_name, tool_id}'
```

The recipe is ready to use once discovery returns a result whose `provider_name` is You.com.

## CLI

Discover candidates, then select the You.com one explicitly:

```bash
# Find capabilities and show their providers
qveris discover "You.com web search API" --limit 15 --json \
  | jq -r '.results[] | "  • \(.name) by \(.provider_name // "Unknown")"'

# Select only the You.com capability (fails closed if none exists)
qveris discover "You.com web search API" --json \
  | jq '[.results[] | select((.provider_name // "") | test("you[.]?com"; "i"))] | first'
```

### Step-by-step workflow

```bash
# 1. Discover web search capabilities
search_result=$(qveris discover "You.com web search API" --json)
search_id=$(echo "$search_result" | jq -r '.search_id')

# 2. Select the You.com capability — exit if none is registered
tool_id=$(echo "$search_result" | jq -r '
  [.results[] | select((.provider_name // "") | test("you[.]?com"; "i"))] | first | .tool_id // empty')
if [[ -z "$tool_id" ]]; then
  echo "No You.com capability registered with QVeris yet; stopping." && exit 0
fi

# 3. Inspect the capability to read its parameter schema
inspect_result=$(qveris inspect "$tool_id" --search-id "$search_id" --json)
echo "$inspect_result" | jq -r '.results[0] | [(.params[]?.name)]'

# 4. Execute a search — build params from the schema the tool declares
#    (capabilities differ: some take "query", others "q")
execution=$(qveris call "$tool_id" \
  --search-id "$search_id" \
  --params '{"query":"latest developments in quantum computing","count":10}' \
  --json)

# 5. Extract execution ID for audit
execution_id=$(echo "$execution" | jq -r '.execution_id')

# 6. Audit the call (optional)
qveris usage --summary --execution-id "$execution_id" --json
qveris ledger --limit 5 --json
```

## Python SDK

```python
import asyncio
from qveris import QverisClient
from qveris.config import QverisConfig

def is_youcom(provider_name):
    return bool(provider_name) and "you.com" in provider_name.lower()

async def search_web(query: str, count: int = 5) -> None:
    """Search the web using You.com through QVeris capability routing.

    Fails closed: if no You.com capability is registered with QVeris,
    this returns without making any paid call.
    """
    client = QverisClient()  # reads QVERIS_API_KEY from the environment
    try:
        # Discover candidate capabilities
        discovered = await client.discover("You.com web search API", limit=10)
        if not discovered.results:
            print("No search capabilities found.")
            return

        # Select the You.com capability explicitly — never fall back to the
        # first result, which may be an unrelated paid provider.
        youcom_tool = next(
            (t for t in discovered.results if is_youcom(t.provider_name)), None
        )
        if youcom_tool is None:
            print("No You.com capability registered with QVeris yet; not calling anything.")
            return

        print(f"Using: {youcom_tool.name} by {youcom_tool.provider_name}")

        # Inspect the capability to read its parameter schema
        inspected = await client.inspect(
            youcom_tool.tool_id,
            search_id=discovered.search_id
        )
        declared = [p.name for p in (inspected.results[0].params or [])] if inspected.results else []
        params = {}
        if not declared or "query" in declared:
            params["query"] = query
        elif "q" in declared:
            params["q"] = query
        if "count" in declared or not declared:
            params["count"] = count

        # Execute the search
        result = await client.call(
            youcom_tool.tool_id,
            params,
            search_id=discovered.search_id
        )

        print("Search Results:")
        print(result.model_dump_json(indent=2))

        # Audit the call (optional). Totals live in the summary object.
        usage = await client.usage(execution_id=result.execution_id, summary=True)
        summary = usage.model_dump().get("summary") or {}
        print(f"Total events: {summary.get('total_events')}, "
              f"Credits used: {summary.get('actual_amount_credits')}")

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
      "args": ["-y", "@qverisai/mcp"],
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

Once a You.com capability is registered, each scenario follows the same discover → select You.com → inspect → call flow from the [CLI section](#cli). Example queries:

### Research Current Events
```bash
qveris discover "You.com web search API" --json \
  | jq -r '.results[] | select((.provider_name // "") | test("you[.]?com"; "i")) | .tool_id'
# then inspect + call with query "breaking news technology", count 10
```

### Product Research
Same flow with query `"iPhone 16 Pro reviews 2026"`, count 5.

### Technical Documentation
Same flow with query `"React 19 new features documentation"`, count 8.

### Trending Topics
Same flow with query `"trending topics AI research"`, count 15.

## Advanced Configuration

### Parameter names differ per capability

Capabilities don't share one schema: some take `query`, others `q`, plus provider-specific fields. Always inspect the selected capability first and construct parameters from its declared `params` list (the Python example above shows the pattern) rather than fanning one assumed schema out across providers.

## Billing and Credits

- **Discovery**: Free through QVeris
- **Execution**: Priced per call through QVeris billing — check the capability's cost signals (`expected_cost`, cost class) from `discover`/`inspect` before calling
- **Audit**: Check exact charges with `qveris usage` and `qveris ledger`

## Troubleshooting

### No You.com capabilities found

```bash
# Check all available search providers
qveris discover "web search" --json | jq '.results[] | {name: .name, provider: .provider_name}'
```

If You.com isn't listed, it isn't registered with QVeris yet — see [Provider onboarding](#provider-onboarding). The recipe deliberately does **not** fall back to another provider in that case, so no unrelated paid calls happen.

## Provider onboarding

Before this recipe can execute anything, You.com must be onboarded to the QVeris capability network and pass integration and capability validation (API docs, sandbox/test account, rate-limit and billing details). That process is handled between the provider and the QVeris team; once complete, the recipe's tool selection works against the registered capability's actual tool ID, parameter schema, response format, and billing metadata. Until then, discovery + the fail-closed selection above are as far as the recipe goes.

### API Key Issues

```bash
# Verify QVeris API key
qveris auth status

# Test discovery with a minimal query
qveris discover "web search" --limit 5 --json
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