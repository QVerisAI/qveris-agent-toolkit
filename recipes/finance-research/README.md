# Finance Research Recipe

Use this recipe to discover, inspect, call, and audit a public company market data capability.

## Quickstart

```bash
export QVERIS_API_KEY="sk-..."
qveris init --query "public company stock quote and market data API" --params '{"symbol":"AAPL"}' --json
```

## CLI

Use the first-call flow when you want QVeris to discover, inspect, select, and call a matching capability in one command:

```bash
qveris init \
  --query "public company stock quote and market data API" \
  --params '{"symbol":"AAPL"}' \
  --max-response-size 20480 \
  --json
```

After a call returns an `execution_id`, audit charge outcome:

```bash
qveris usage --execution-id "exec_..." --summary --json
qveris ledger --limit 5 --summary --json
```

## Python SDK

```python
import asyncio
from qveris import QverisClient

async def main() -> None:
    client = QverisClient()
    try:
        discovered = await client.discover("public company stock quote and market data API", limit=5)
        if not discovered.results:
            print("No capabilities found.")
            return
        tool = discovered.results[0]
        inspected = await client.inspect(tool.tool_id, search_id=discovered.search_id)
        selected = inspected.results[0] if inspected.results else tool
        result = await client.call(selected.tool_id, {"symbol": "AAPL"}, search_id=discovered.search_id)
        print(result.model_dump())
        print((await client.usage(execution_id=result.execution_id, summary=True)).model_dump())
    finally:
        await client.close()

asyncio.run(main())
```
