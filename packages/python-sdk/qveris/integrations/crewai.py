"""CrewAI adapter for QVeris.

Exposes the QVeris ``discover`` / ``inspect`` / ``call`` workflow as CrewAI
tools, so a CrewAI agent can find and invoke thousands of external capabilities
through one QVeris API key.

    pip install qveris[crewai]

    from crewai import Agent
    from qveris import QverisClient
    from qveris.integrations.crewai import get_qveris_tools, aclose

    client = QverisClient()
    agent = Agent(role="Researcher", goal="...", backstory="...",
                  tools=get_qveris_tools(client))
    # ... run your crew synchronously (crew.kickoff()), then:
    aclose(client)

CrewAI executes tools synchronously; these tools bridge to the async QVeris
client on a single dedicated background event loop, so they work under both
``crew.kickoff()`` and ``crew.kickoff_async()``. Because the client's async
resources bind to that loop, close it with :func:`aclose` (which runs on the
same loop) rather than ``await client.close()``. Tools return JSON strings and
thread ``search_id`` from discover into inspect/call.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import threading
from typing import Any, Coroutine, Dict, List, Optional, Type

from pydantic import BaseModel, Field

from ..client.api import QverisClient

_INSTALL_HINT = "The CrewAI integration requires 'crewai'. Install it with: pip install qveris[crewai]"


class _BridgeLoop:
    """A single, long-lived event loop on a daemon thread.

    CrewAI tools are synchronous but the QVeris client is async and holds a
    persistent ``httpx.AsyncClient`` whose connection pool binds to the loop it
    first runs on. Dispatching every call onto one stable loop (instead of a
    fresh ``asyncio.run`` per call) keeps that client valid across the many
    tool calls a crew makes, and works whether or not the caller has its own
    running loop.
    """

    def __init__(self) -> None:
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._lock = threading.Lock()

    def _ensure(self) -> asyncio.AbstractEventLoop:
        with self._lock:
            if self._loop is None:
                loop = asyncio.new_event_loop()
                threading.Thread(target=loop.run_forever, name="qveris-crewai-loop", daemon=True).start()
                self._loop = loop
            return self._loop

    def submit(self, coro: Coroutine[Any, Any, Any]) -> "concurrent.futures.Future[Any]":
        """Schedule a coroutine on the bridge loop; return its concurrent Future."""
        return asyncio.run_coroutine_threadsafe(coro, self._ensure())

    def run(self, coro: Coroutine[Any, Any, Any]) -> Any:
        return self.submit(coro).result()


_BRIDGE = _BridgeLoop()


def _run_sync(coro: Coroutine[Any, Any, Any]) -> Any:
    """Run an async coroutine on the shared CrewAI bridge loop and block for it."""
    return _BRIDGE.run(coro)


async def _run_async(coro: Coroutine[Any, Any, Any]) -> Any:
    """Await a coroutine on the shared bridge loop from within another loop.

    Used by the tools' ``_arun`` path (CrewAI ``kickoff_async``): the work still
    runs on the one bridge loop the client is bound to, so ``aclose`` and the
    sync path stay consistent, while the caller's loop is not blocked.
    """
    return await asyncio.wrap_future(_BRIDGE.submit(coro))


def aclose(client: QverisClient) -> None:
    """Close a QVeris client whose async work ran through the CrewAI tools.

    The client's connections are bound to the bridge loop, so ``close()`` must
    run there too — a plain ``await client.close()`` on a different loop would
    raise a cross-loop error. Call this instead when you're done with the crew.
    """
    _run_sync(client.close())


class _DiscoverArgs(BaseModel):
    query: str = Field(description="Capability query in natural language, e.g. 'weather forecast API'.")
    limit: int = Field(default=20, description="Number of results to return (1-100).")


class _InspectArgs(BaseModel):
    tool_ids: List[str] = Field(description="Tool IDs returned by discover.")
    search_id: Optional[str] = Field(default=None, description="The search_id from the discover response, if available.")


class _CallArgs(BaseModel):
    tool_id: str = Field(description="The capability tool_id, from discover or inspect.")
    params_to_tool: Dict[str, Any] = Field(description="Parameters to pass to the capability.")
    search_id: Optional[str] = Field(default=None, description="The search_id from the discover response, if available.")
    max_response_size: Optional[int] = Field(default=None, description="Max response size in bytes; -1 means unlimited.")


def get_qveris_tools(
    client: QverisClient,
    *,
    session_id: Optional[str] = None,
) -> List[Any]:
    """Return CrewAI tools for the QVeris discover/inspect/call workflow.

    Args:
        client: The ``QverisClient`` to route calls through. You own its
            lifecycle — the tools hold a reference to it, so keep it open for
            as long as the tools are used and ``await client.close()`` when done.
        session_id: Optional session id for correlation/pricing context.

    Returns:
        A list of three CrewAI ``BaseTool`` instances named ``qveris_discover``,
        ``qveris_inspect``, and ``qveris_call``.

    Raises:
        ImportError: if ``crewai`` is not installed.
    """
    try:
        from crewai.tools import BaseTool
    except ImportError as exc:  # pragma: no cover - exercised via install extras
        raise ImportError(_INSTALL_HINT) from exc

    async def _route(name: str, args: Dict[str, Any]) -> str:
        result, _is_error, _handled = await client.handle_tool_call(name, args, session_id=session_id)
        return json.dumps(result, default=str)

    def _call_args(
        tool_id: str,
        params_to_tool: Dict[str, Any],
        search_id: Optional[str],
        max_response_size: Optional[int],
    ) -> Dict[str, Any]:
        args: Dict[str, Any] = {"tool_id": tool_id, "params_to_tool": params_to_tool}
        if search_id is not None:
            args["search_id"] = search_id
        if max_response_size is not None:
            args["max_response_size"] = max_response_size
        return args

    class QverisDiscoverTool(BaseTool):
        name: str = "qveris_discover"
        description: str = (
            "Discover QVeris capabilities from a natural-language query. Free; returns candidates and a search_id."
        )
        args_schema: Type[BaseModel] = _DiscoverArgs

        def _run(self, query: str, limit: int = 20) -> str:
            return _run_sync(_route("discover", {"query": query, "limit": limit}))

        async def _arun(self, query: str, limit: int = 20) -> str:
            return await _run_async(_route("discover", {"query": query, "limit": limit}))

    class QverisInspectTool(BaseTool):
        name: str = "qveris_inspect"
        description: str = "Inspect one or more QVeris capabilities by tool_id before calling them. Free."
        args_schema: Type[BaseModel] = _InspectArgs

        def _run(self, tool_ids: List[str], search_id: Optional[str] = None) -> str:
            return _run_sync(_route("inspect", {"tool_ids": tool_ids, "search_id": search_id}))

        async def _arun(self, tool_ids: List[str], search_id: Optional[str] = None) -> str:
            return await _run_async(_route("inspect", {"tool_ids": tool_ids, "search_id": search_id}))

    class QverisCallTool(BaseTool):
        name: str = "qveris_call"
        description: str = "Call a selected QVeris capability with parameters. May consume credits."
        args_schema: Type[BaseModel] = _CallArgs

        def _run(
            self,
            tool_id: str,
            params_to_tool: Dict[str, Any],
            search_id: Optional[str] = None,
            max_response_size: Optional[int] = None,
        ) -> str:
            return _run_sync(_route("call", _call_args(tool_id, params_to_tool, search_id, max_response_size)))

        async def _arun(
            self,
            tool_id: str,
            params_to_tool: Dict[str, Any],
            search_id: Optional[str] = None,
            max_response_size: Optional[int] = None,
        ) -> str:
            return await _run_async(_route("call", _call_args(tool_id, params_to_tool, search_id, max_response_size)))

    return [QverisDiscoverTool(), QverisInspectTool(), QverisCallTool()]
