import asyncio
import json
from typing import Any, Dict, List, Optional, Tuple

import pytest

pytest.importorskip("crewai", reason="CrewAI integration requires crewai (Python >=3.10)")

from qveris.integrations.crewai import aclose, get_qveris_tools  # noqa: E402


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


def test_all_tool_calls_run_on_one_shared_event_loop() -> None:
    """Multiple tool calls must run on the SAME loop so a persistent async
    client (e.g. httpx.AsyncClient) stays valid across a crew's many calls.
    A fresh asyncio.run per call would give a different, closed loop each time.
    """
    loop_ids: List[int] = []

    class LoopRecordingClient:
        async def handle_tool_call(self, func_name, func_args, session_id=None):
            loop_ids.append(id(asyncio.get_running_loop()))
            return {"ok": True}, False, True

    tools = get_qveris_tools(LoopRecordingClient())
    _tool(tools, "qveris_discover")._run(query="x")
    _tool(tools, "qveris_inspect")._run(tool_ids=["t"])
    _tool(tools, "qveris_call")._run(tool_id="t", search_id="s", params_to_tool={})

    assert len(loop_ids) == 3
    assert len(set(loop_ids)) == 1  # all three on one stable bridge loop


def test_call_tool_omits_absent_search_id() -> None:
    client = FakeClient()
    call = _tool(get_qveris_tools(client), "qveris_call")

    call._run(tool_id="t1", params_to_tool={})

    assert "search_id" not in client.calls[0]["args"]
    assert client.calls[0]["args"] == {"tool_id": "t1", "params_to_tool": {}}


def test_arun_dispatches_work_onto_the_bridge_loop() -> None:
    """CrewAI's async path (_arun / kickoff_async) must still run client work on
    the one bridge loop the persistent client is bound to — not the caller's
    loop — so aclose and the sync path stay consistent.
    """
    loop_ids: List[int] = []

    class LoopRecordingClient:
        async def handle_tool_call(self, func_name, func_args, session_id=None):
            loop_ids.append(id(asyncio.get_running_loop()))
            return {"ok": True}, False, True

    discover = _tool(get_qveris_tools(LoopRecordingClient()), "qveris_discover")
    discover._run(query="x")  # sync path records the bridge loop
    bridge_loop_id = loop_ids[0]

    async def drive() -> str:
        # This coroutine runs on a *different* loop (asyncio.run); _arun must
        # not execute the client on it.
        return await discover._arun(query="y")

    asyncio.run(drive())

    assert len(loop_ids) == 2
    assert loop_ids[1] == bridge_loop_id


def test_aclose_runs_client_close_on_the_bridge_loop() -> None:
    closed_on: Dict[str, Any] = {}

    class ClosableClient:
        async def handle_tool_call(self, func_name, func_args, session_id=None):
            closed_on["call_loop"] = id(asyncio.get_running_loop())
            return {"ok": True}, False, True

        async def close(self):
            closed_on["close_loop"] = id(asyncio.get_running_loop())

    client = ClosableClient()
    tools = get_qveris_tools(client)
    _tool(tools, "qveris_discover")._run(query="x")
    aclose(client)

    # close() ran, and on the same loop the tool calls (and thus the client) used.
    assert closed_on["close_loop"] == closed_on["call_loop"]
