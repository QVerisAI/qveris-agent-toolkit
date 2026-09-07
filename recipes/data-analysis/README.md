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
  --max-size 20480 \
  --json
```

Audit the sample call:

```bash
qveris usage --execution-id "exec_..." --json
qveris ledger --limit 5 --json
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
        parameters = {"domain": "qveris.ai"}
        selected = next(
            (tool for tool in discovered.results if tool.params is not None
             and set(parameters) <= {parameter.name for parameter in tool.params}
             and {parameter.name for parameter in tool.params if parameter.required} <= set(parameters)),
            None,
        )
        if selected is None:
            inspected = await client.inspect(
                [tool.tool_id for tool in discovered.results[:3]], search_id=discovered.search_id
            )
            selected = next(
                (tool for tool in inspected.results if tool.params is not None
                 and set(parameters) <= {parameter.name for parameter in tool.params}
                 and {parameter.name for parameter in tool.params if parameter.required} <= set(parameters)),
                None,
            )
        if selected is None:
            raise RuntimeError("No candidate exposed a compatible current contract")
        result = await client.call(selected.tool_id, parameters, search_id=discovered.search_id)
        print(result.model_dump())
    finally:
        await client.close()

asyncio.run(main())
```
