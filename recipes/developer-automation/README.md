# Developer Automation Recipe

Use this recipe to discover and test a developer-facing API, such as repository metadata, package metadata, release lookup, or issue search.

## Quickstart

```bash
export QVERIS_API_KEY="sk-..."
qveris init --query "GitHub repository metadata API" --params '{"owner":"QVerisAI","repo":"qveris-agent-toolkit"}' --json
```

## CLI

```bash
qveris init \
  --query "GitHub repository metadata API" \
  --params '{"owner":"QVerisAI","repo":"qveris-agent-toolkit"}' \
  --max-response-size 20480 \
  --json
```

Audit the call:

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
        discovered = await client.discover("GitHub repository metadata API", limit=5)
        if not discovered.results:
            print("No capabilities found.")
            return
        tool = discovered.results[0]
        inspected = await client.inspect(tool.tool_id, search_id=discovered.search_id)
        selected = inspected.results[0] if inspected.results else tool
        result = await client.call(
            selected.tool_id,
            {"owner": "QVerisAI", "repo": "qveris-agent-toolkit"},
            search_id=discovered.search_id,
        )
        print(result.model_dump())
    finally:
        await client.close()

asyncio.run(main())
```
