import json
from typing import Any, Dict, List, Optional, Tuple

import pytest

pytest.importorskip("langchain_core", reason="LangChain integration requires langchain-core (Python >=3.9)")

from qveris.integrations.langchain import get_qveris_tools  # noqa: E402


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
            return {"results": [{"tool_id": "t1", "name": "T"}]}, False, True
        return {"execution_id": "e1", "success": True}, False, True


def test_get_qveris_tools_exposes_three_named_tools() -> None:
    tools = get_qveris_tools(FakeClient())
    assert [t.name for t in tools] == ["qveris_discover", "qveris_inspect", "qveris_call"]
    for tool in tools:
        assert tool.description
        assert tool.args_schema is not None


@pytest.mark.asyncio
async def test_discover_tool_routes_to_handle_tool_call_and_returns_json() -> None:
    client = FakeClient()
    discover = next(t for t in get_qveris_tools(client, session_id="sess-1") if t.name == "qveris_discover")

    out = await discover.ainvoke({"query": "weather forecast API", "limit": 3})

    assert client.calls == [
        {"name": "discover", "args": {"query": "weather forecast API", "limit": 3}, "session_id": "sess-1"}
    ]
    parsed = json.loads(out)
    assert parsed["search_id"] == "s1"


@pytest.mark.asyncio
async def test_call_tool_threads_ids_and_omits_absent_max_response_size() -> None:
    client = FakeClient()
    call = next(t for t in get_qveris_tools(client) if t.name == "qveris_call")

    out = await call.ainvoke(
        {"tool_id": "t1", "search_id": "s1", "params_to_tool": {"city": "London"}}
    )

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
    inspect = next(t for t in get_qveris_tools(client) if t.name == "qveris_inspect")

    await inspect.ainvoke({"tool_ids": ["t1", "t2"], "search_id": "s1"})

    assert client.calls[0]["name"] == "inspect"
    assert client.calls[0]["args"] == {"tool_ids": ["t1", "t2"], "search_id": "s1"}
