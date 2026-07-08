"""LangChain adapter for QVeris.

Exposes the QVeris ``discover`` / ``inspect`` / ``call`` workflow as LangChain
tools, so an agent built on LangChain (or LangGraph) can find and invoke
thousands of external capabilities through one QVeris API key.

    pip install qveris[langchain]

    from qveris import QverisClient
    from qveris.integrations.langchain import get_qveris_tools

    client = QverisClient()
    tools = get_qveris_tools(client)   # 3 async LangChain tools
    # bind `tools` to a LangChain / LangGraph agent, then close the client when done

The tools are async (use ``ainvoke`` / an async agent executor). They return
JSON strings — the same payloads the model sees in the built-in QVeris agent —
and thread ``search_id`` from discover into inspect/call the way the tool
descriptions instruct.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from ..client.api import QverisClient

_INSTALL_HINT = (
    "The LangChain integration requires 'langchain-core'. "
    "Install it with: pip install qveris[langchain]"
)


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
    max_response_size: Optional[int] = Field(
        default=None, description="Max response size in bytes; -1 means unlimited."
    )


def get_qveris_tools(
    client: Optional[QverisClient] = None,
    *,
    session_id: Optional[str] = None,
) -> List[Any]:
    """Return LangChain tools for the QVeris discover/inspect/call workflow.

    Args:
        client: A ``QverisClient`` to route calls through. If omitted, one is
            created from the environment (``QVERIS_API_KEY``); you are then
            responsible for closing it (``await client.close()``).
        session_id: Optional session id for correlation/pricing context.

    Returns:
        A list of three async LangChain ``StructuredTool`` objects named
        ``qveris_discover``, ``qveris_inspect``, and ``qveris_call``.

    Raises:
        ImportError: if ``langchain-core`` is not installed.
    """
    try:
        from langchain_core.tools import StructuredTool
    except ImportError as exc:  # pragma: no cover - exercised via install extras
        raise ImportError(_INSTALL_HINT) from exc

    qveris = client or QverisClient()

    async def _route(name: str, args: Dict[str, Any]) -> str:
        result, _is_error, _handled = await qveris.handle_tool_call(name, args, session_id=session_id)
        return json.dumps(result, default=str)

    async def _discover(query: str, limit: int = 20) -> str:
        return await _route("discover", {"query": query, "limit": limit})

    async def _inspect(tool_ids: List[str], search_id: Optional[str] = None) -> str:
        return await _route("inspect", {"tool_ids": tool_ids, "search_id": search_id})

    async def _call(
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
        return await _route("call", args)

    return [
        StructuredTool.from_function(
            coroutine=_discover,
            name="qveris_discover",
            description="Discover QVeris capabilities from a natural-language query. Free; returns candidates and a search_id.",
            args_schema=_DiscoverArgs,
        ),
        StructuredTool.from_function(
            coroutine=_inspect,
            name="qveris_inspect",
            description="Inspect one or more QVeris capabilities by tool_id before calling them. Free.",
            args_schema=_InspectArgs,
        ),
        StructuredTool.from_function(
            coroutine=_call,
            name="qveris_call",
            description="Call a selected QVeris capability with parameters. May consume credits.",
            args_schema=_CallArgs,
        ),
    ]
