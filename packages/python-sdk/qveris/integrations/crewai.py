"""CrewAI adapter for QVeris.

Exposes the QVeris ``discover`` / ``inspect`` / ``call`` workflow as CrewAI
tools, so a CrewAI agent can find and invoke thousands of external capabilities
through one QVeris API key.

    pip install qveris[crewai]

    from crewai import Agent
    from qveris import QverisClient
    from qveris.integrations.crewai import get_qveris_tools

    client = QverisClient()
    agent = Agent(role="Researcher", goal="...", backstory="...",
                  tools=get_qveris_tools(client))
    # ... run your crew, then: await client.close()

CrewAI executes tools synchronously; these tools bridge to the async QVeris
client internally, so they work under both ``crew.kickoff()`` and
``crew.kickoff_async()``. Tools return JSON strings and thread ``search_id``
from discover into inspect/call.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
from typing import Any, Coroutine, Dict, List, Optional, Type

from pydantic import BaseModel, Field

from ..client.api import QverisClient

_INSTALL_HINT = "The CrewAI integration requires 'crewai'. Install it with: pip install qveris[crewai]"


def _run_sync(coro: Coroutine[Any, Any, Any]) -> Any:
    """Run an async coroutine from CrewAI's synchronous tool context.

    Uses ``asyncio.run`` when no loop is running (``crew.kickoff()``); if a loop
    is already running (``crew.kickoff_async()``), runs the coroutine in a
    worker thread with its own loop to avoid "loop already running" errors.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(asyncio.run, coro).result()


class _DiscoverArgs(BaseModel):
    query: str = Field(description="Capability query in natural language, e.g. 'weather forecast API'.")
    limit: int = Field(default=20, description="Number of results to return (1-100).")


class _InspectArgs(BaseModel):
    tool_ids: List[str] = Field(description="Tool IDs returned by discover.")
    search_id: Optional[str] = Field(default=None, description="The search_id from the discover response, if available.")


class _CallArgs(BaseModel):
    tool_id: str = Field(description="The capability tool_id, from discover or inspect.")
    search_id: str = Field(description="The search_id from the discover response.")
    params_to_tool: Dict[str, Any] = Field(description="Parameters to pass to the capability.")
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

    class QverisDiscoverTool(BaseTool):
        name: str = "qveris_discover"
        description: str = (
            "Discover QVeris capabilities from a natural-language query. Free; returns candidates and a search_id."
        )
        args_schema: Type[BaseModel] = _DiscoverArgs

        def _run(self, query: str, limit: int = 20) -> str:
            return _run_sync(_route("discover", {"query": query, "limit": limit}))

    class QverisInspectTool(BaseTool):
        name: str = "qveris_inspect"
        description: str = "Inspect one or more QVeris capabilities by tool_id before calling them. Free."
        args_schema: Type[BaseModel] = _InspectArgs

        def _run(self, tool_ids: List[str], search_id: Optional[str] = None) -> str:
            return _run_sync(_route("inspect", {"tool_ids": tool_ids, "search_id": search_id}))

    class QverisCallTool(BaseTool):
        name: str = "qveris_call"
        description: str = "Call a selected QVeris capability with parameters. May consume credits."
        args_schema: Type[BaseModel] = _CallArgs

        def _run(
            self,
            tool_id: str,
            search_id: str,
            params_to_tool: Dict[str, Any],
            max_response_size: Optional[int] = None,
        ) -> str:
            args: Dict[str, Any] = {
                "tool_id": tool_id,
                "search_id": search_id,
                "params_to_tool": params_to_tool,
            }
            if max_response_size is not None:
                args["max_response_size"] = max_response_size
            return _run_sync(_route("call", args))

    return [QverisDiscoverTool(), QverisInspectTool(), QverisCallTool()]
