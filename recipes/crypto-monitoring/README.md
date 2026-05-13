# Crypto Monitoring Recipe

Use this recipe to discover and call a cryptocurrency market data capability.

## Quickstart

```bash
export QVERIS_API_KEY="sk-..."
qveris init --query "cryptocurrency market price and volume API" --params '{"symbol":"BTC","currency":"USD"}' --json
```

## CLI

```bash
qveris init \
  --query "cryptocurrency market price and volume API" \
  --params '{"symbol":"BTC","currency":"USD"}' \
  --max-response-size 20480 \
  --json
```

Use audit commands after execution:

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
        discovered = await client.discover("cryptocurrency market price and volume API", limit=5)
        if not discovered.results:
            print("No capabilities found.")
            return
        tool = discovered.results[0]
        inspected = await client.inspect(tool.tool_id, search_id=discovered.search_id)
        selected = inspected.results[0] if inspected.results else tool
        result = await client.call(
            selected.tool_id,
            {"symbol": "BTC", "currency": "USD"},
            search_id=discovered.search_id,
        )
        print(result.model_dump())
    finally:
        await client.close()

asyncio.run(main())
```
