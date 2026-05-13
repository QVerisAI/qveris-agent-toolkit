# Risk And Compliance Recipe

Use this recipe to find and test a sanctions, adverse media, or entity screening capability.

## Quickstart

```bash
export QVERIS_API_KEY="sk-..."
qveris init --query "sanctions screening or adverse media compliance API" --params '{"name":"Acme Trading Ltd"}' --json
```

## CLI

```bash
qveris init \
  --query "sanctions screening or adverse media compliance API" \
  --params '{"name":"Acme Trading Ltd"}' \
  --max-response-size 20480 \
  --json
```

Audit the execution after you receive `execution_id`:

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
        discovered = await client.discover("sanctions screening or adverse media compliance API", limit=5)
        if not discovered.results:
            print("No capabilities found.")
            return
        tool = discovered.results[0]
        inspected = await client.inspect(tool.tool_id, search_id=discovered.search_id)
        selected = inspected.results[0] if inspected.results else tool
        result = await client.call(selected.tool_id, {"name": "Acme Trading Ltd"}, search_id=discovered.search_id)
        print(result.model_dump())
    finally:
        await client.close()

asyncio.run(main())
```
