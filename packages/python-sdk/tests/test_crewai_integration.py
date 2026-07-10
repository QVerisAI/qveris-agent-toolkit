import asyncio
from typing import Any, Dict, List, Optional

import pytest

pytest.importorskip("crewai", reason="CrewAI integration requires crewai (Python >=3.10)")

from qveris.integrations.crewai import aclose, get_qveris_tools  # noqa: E402

from adapter_conformance import AdapterConformance  # noqa: E402


class TestCrewAIAdapterConformance(AdapterConformance):
    """Shared invariants (see adapter_conformance.py) for the CrewAI adapter."""

    def make_tools(self, client: Any, session_id: Optional[str] = None) -> List[Any]:
        return get_qveris_tools(client, session_id=session_id)

    def make_tools_no_client(self) -> Any:
        return get_qveris_tools()  # type: ignore[call-arg]

    def invoke(self, tool: Any, args: Dict[str, Any]) -> str:
        # CrewAI tools are synchronous; they bridge to the async client internally.
        return tool._run(**args)


# --- CrewAI-specific behavior: the sync/async bridge loop ---------------------


def _tool(tools, name):
    return next(t for t in tools if t.name == name)


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
