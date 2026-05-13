# Data Analysis Enrichment Recipe

Use this recipe to test an external data enrichment capability before applying it to a larger dataset.

## Quickstart

```bash
export QVERIS_API_KEY="sk-..."
qveris init --query "company domain enrichment API" --params '{"domain":"qveris.ai"}' --json
```

## CLI

```bash
qveris init \
  --query "company domain enrichment API" \
  --params '{"domain":"qveris.ai"}' \
  --max-response-size 20480 \
  --json
```

Audit the sample call:

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
        discovered = await client.discover("company domain enrichment API", limit=5)
        if not discovered.results:
            print("No capabilities found.")
            return
        tool = discovered.results[0]
        inspected = await client.inspect(tool.tool_id, search_id=discovered.search_id)
        selected = inspected.results[0] if inspected.results else tool
        result = await client.call(selected.tool_id, {"domain": "qveris.ai"}, search_id=discovered.search_id)
        print(result.model_dump())
    finally:
        await client.close()

asyncio.run(main())
```
