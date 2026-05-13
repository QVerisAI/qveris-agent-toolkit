import os
from typing import Any, Dict, Optional

from qveris import QverisClient, ToolInfo


def require_api_key() -> bool:
    if os.getenv("QVERIS_API_KEY"):
        return True
    print("Set QVERIS_API_KEY to run this example against the QVeris API.")
    return False


def should_call() -> bool:
    return os.getenv("RUN_QVERIS_CALLS") == "1"


def sample_parameters(tool: ToolInfo, fallback: Dict[str, Any]) -> Dict[str, Any]:
    if tool.examples and tool.examples.sample_parameters:
        return tool.examples.sample_parameters
    return fallback


async def preview_capability(
    query: str,
    fallback_params: Dict[str, Any],
    *,
    limit: int = 5,
    max_response_size: Optional[int] = 4096,
) -> None:
    if not require_api_key():
        return

    client = QverisClient()
    try:
        discovered = await client.discover(query, limit=limit)
        print(f"search_id: {discovered.search_id}")
        print(f"matches: {len(discovered.results)} / total={discovered.total}")
        if not discovered.results:
            return

        tool = discovered.results[0]
        inspected = await client.inspect([tool.tool_id], search_id=discovered.search_id)
        tool = inspected.results[0] if inspected.results else tool
        print(f"selected: {tool.tool_id} - {tool.name or tool.description or 'unnamed'}")
        if tool.stats:
            print(f"quality: success_rate={tool.stats.success_rate} latency_ms={tool.stats.avg_execution_time_ms}")
        if tool.billing_rule:
            print(f"billing: {tool.billing_rule.description or tool.billing_rule.metering_mode}")

        params = sample_parameters(tool, fallback_params)
        print(f"params: {params}")
        if not should_call():
            print("Set RUN_QVERIS_CALLS=1 to execute the selected capability.")
            return

        result = await client.call(
            tool.tool_id,
            params,
            search_id=discovered.search_id,
            max_response_size=max_response_size,
        )
        print(f"execution_id: {result.execution_id}")
        print(f"success: {result.success}")
        print(f"billing: {result.billing.summary if result.billing else None}")
        print(f"result: {result.result}")
        usage = await client.usage(execution_id=result.execution_id, summary=True, limit=5)
        print(f"usage_records: {usage.total}")
        ledger = await client.ledger(summary=True, limit=5)
        print(f"ledger_records: {ledger.total}")
    finally:
        await client.close()
