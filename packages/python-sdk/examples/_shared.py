import math
import os
from typing import Any, Dict, List, Optional

from qveris import QverisClient, ToolInfo


def require_api_key() -> bool:
    if os.getenv("QVERIS_API_KEY"):
        return True
    print("Set QVERIS_API_KEY to run this example against the QVeris API.")
    return False


def should_call() -> bool:
    return os.getenv("RUN_QVERIS_CALLS") == "1"


def _matches_parameter_type(parameter_type: Any, value: Any) -> bool:
    if parameter_type == "string":
        return isinstance(value, str)
    if parameter_type == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if parameter_type == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    if parameter_type == "boolean":
        return isinstance(value, bool)
    if parameter_type == "array":
        return isinstance(value, list)
    if parameter_type == "object":
        return isinstance(value, dict)
    return False


def _matches_enum(allowed_values: Optional[List[Any]], value: Any) -> bool:
    if allowed_values is None:
        return True
    return any(
        allowed == value and not (isinstance(allowed, bool) != isinstance(value, bool)) for allowed in allowed_values
    )


def supports_parameters(tool: ToolInfo, requested: Dict[str, Any]) -> bool:
    """Require an explicit contract compatible with every supplied value."""
    if tool.params is None:
        return False
    definitions = {param.name: param for param in tool.params}
    if len(definitions) != len(tool.params):
        return False
    required = {param.name for param in tool.params if param.required}
    return required.issubset(requested) and all(
        (parameter := definitions.get(name)) is not None
        and _matches_parameter_type(parameter.type, value)
        and _matches_enum(parameter.enum, value)
        for name, value in requested.items()
    )


async def preview_capability(
    query: str,
    requested_params: Dict[str, Any],
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

        tool = next(
            (candidate for candidate in discovered.results if supports_parameters(candidate, requested_params)), None
        )
        if tool is None:
            inspected = await client.inspect(
                [candidate.tool_id for candidate in discovered.results[:3]],
                search_id=discovered.search_id,
            )
            tool = next(
                (candidate for candidate in inspected.results if supports_parameters(candidate, requested_params)), None
            )
        if tool is None:
            raise RuntimeError("No candidate exposed a current contract compatible with the requested parameters")
        print(f"selected: {tool.tool_id} - {tool.name or tool.description or 'unnamed'}")
        if tool.stats:
            print(f"quality: success_rate={tool.stats.success_rate} latency_ms={tool.stats.avg_execution_time_ms}")
        if tool.billing_rule:
            print(f"billing: {tool.billing_rule.description or tool.billing_rule.metering_mode}")

        # Samples describe shape only; values always come from the current task.
        params = requested_params
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
