import json
from typing import Any, Dict, List, Optional, Tuple

import pytest

pytest.importorskip("crewai", reason="CrewAI integration requires crewai (Python >=3.10)")

from qveris.integrations.crewai import get_qveris_tools  # noqa: E402


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


def test_get_qveris_tools_exposes_three_named_tools() -> None:
    tools = get_qveris_tools(FakeClient())
    assert [t.name for t in tools] == ["qveris_discover", "qveris_inspect", "qveris_call"]
    for tool in tools:
        assert tool.description
        assert tool.args_schema is not None


def test_discover_tool_routes_to_handle_tool_call() -> None:
    client = FakeClient()
    discover = _tool(get_qveris_tools(client, session_id="sess-1"), "qveris_discover")

    # _run bridges the async client synchronously (no running loop in this test).
    out = discover._run(query="weather forecast API", limit=3)

    assert client.calls == [
        {"name": "discover", "args": {"query": "weather forecast API", "limit": 3}, "session_id": "sess-1"}
    ]
    assert json.loads(out)["search_id"] == "s1"


def test_call_tool_threads_ids_and_omits_absent_max_response_size() -> None:
    client = FakeClient()
    call = _tool(get_qveris_tools(client), "qveris_call")

    out = call._run(tool_id="t1", search_id="s1", params_to_tool={"city": "London"})

    assert client.calls[0]["name"] == "call"
    assert client.calls[0]["args"] == {
        "tool_id": "t1",
        "search_id": "s1",
        "params_to_tool": {"city": "London"},
    }
    assert "max_response_size" not in client.calls[0]["args"]
    assert json.loads(out)["execution_id"] == "e1"


def test_inspect_tool_passes_tool_ids_and_search_id() -> None:
    client = FakeClient()
    inspect = _tool(get_qveris_tools(client), "qveris_inspect")

    inspect._run(tool_ids=["t1", "t2"], search_id="s1")

    assert client.calls[0]["name"] == "inspect"
    assert client.calls[0]["args"] == {"tool_ids": ["t1", "t2"], "search_id": "s1"}
