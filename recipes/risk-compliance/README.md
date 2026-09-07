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
  --max-size 20480 \
  --json
```

Audit the execution after you receive `execution_id`:

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
        discovered = await client.discover("sanctions screening or adverse media compliance API", limit=5)
        if not discovered.results:
            print("No capabilities found.")
            return
        parameters = {"name": "Acme Trading Ltd"}
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
