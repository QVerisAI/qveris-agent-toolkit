import json
from typing import Any, Dict, List, Optional, Tuple

import pytest

pytest.importorskip("agents", reason="OpenAI Agents integration requires openai-agents (Python >=3.10)")

from agents.tool_context import ToolContext  # noqa: E402

from qveris.integrations.openai_agents import get_qveris_tools  # noqa: E402


class FakeClient:
    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []

    async def handle_tool_call(
        self, func_name: str, func_args: Dict[str, Any], session_id: Optional[str] = None
    ) -> Tuple[Any, bool, bool]:
        self.calls.append({"name": func_name, "args": func_args, "session_id": session_id})
        if func_name == "discover":
            return {"search_id": "s1", "results": [{"tool_id": "t1"}]}, False, True
        if func_name == "inspect":
            return {"results": [{"tool_id": "t1"}]}, False, True
        return {"execution_id": "e1", "success": True}, False, True


def _tool(tools, name):
    return next(t for t in tools if t.name == name)


async def _invoke(tool, args: Dict[str, Any]) -> str:
    ctx = ToolContext(
        context=None,
        tool_name=tool.name,
        tool_call_id="call-1",
        tool_arguments=json.dumps(args),
    )
    return await tool.on_invoke_tool(ctx, json.dumps(args))


def test_get_qveris_tools_exposes_three_named_function_tools() -> None:
    tools = get_qveris_tools(FakeClient())
    assert [t.name for t in tools] == ["qveris_discover", "qveris_inspect", "qveris_call"]
    props = {t.name: set(t.params_json_schema.get("properties", {})) for t in tools}
    assert props["qveris_discover"] == {"query", "limit"}
    assert props["qveris_inspect"] == {"tool_ids", "search_id"}
    assert props["qveris_call"] == {"tool_id", "search_id", "params_to_tool", "max_response_size"}


@pytest.mark.asyncio
async def test_discover_tool_routes_to_handle_tool_call() -> None:
    client = FakeClient()
    discover = _tool(get_qveris_tools(client, session_id="sess-1"), "qveris_discover")

    out = await _invoke(discover, {"query": "weather forecast API", "limit": 3})

    assert client.calls == [
        {"name": "discover", "args": {"query": "weather forecast API", "limit": 3}, "session_id": "sess-1"}
    ]
    assert json.loads(out)["search_id"] == "s1"


@pytest.mark.asyncio
async def test_call_tool_threads_ids_and_omits_absent_max_response_size() -> None:
    client = FakeClient()
    call = _tool(get_qveris_tools(client), "qveris_call")

    out = await _invoke(call, {"tool_id": "t1", "search_id": "s1", "params_to_tool": {"city": "London"}})

    assert client.calls[0]["name"] == "call"
    assert client.calls[0]["args"] == {
        "tool_id": "t1",
        "search_id": "s1",
        "params_to_tool": {"city": "London"},
    }
    assert "max_response_size" not in client.calls[0]["args"]
    assert json.loads(out)["execution_id"] == "e1"


@pytest.mark.asyncio
async def test_inspect_tool_passes_tool_ids_and_search_id() -> None:
    client = FakeClient()
    inspect = _tool(get_qveris_tools(client), "qveris_inspect")

    await _invoke(inspect, {"tool_ids": ["t1", "t2"], "search_id": "s1"})

    assert client.calls[0]["name"] == "inspect"
    assert client.calls[0]["args"] == {"tool_ids": ["t1", "t2"], "search_id": "s1"}
