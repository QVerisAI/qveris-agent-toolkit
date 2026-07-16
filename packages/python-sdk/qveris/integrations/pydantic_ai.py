"""Pydantic AI adapter for QVeris.

Exposes the QVeris ``discover`` / ``inspect`` / ``call`` workflow as native
Pydantic AI ``Tool`` objects.

    pip install "qveris[pydantic-ai]"

The tools are async and return JSON strings. Pass them to ``Agent(tools=...)``
and close the QVeris client when finished.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from ..client.api import QverisClient

_INSTALL_HINT = (
    "The Pydantic AI integration requires 'pydantic-ai-slim'. Install it with: pip install \"qveris[pydantic-ai]\""
)


def get_qveris_tools(
    client: QverisClient,
    *,
    session_id: Optional[str] = None,
) -> List[Any]:
    """Return Pydantic AI tools for the QVeris discover/inspect/call workflow."""
    try:
        from pydantic_ai import Tool
    except ImportError as exc:  # pragma: no cover - exercised via install extras
        raise ImportError(_INSTALL_HINT) from exc

    async def _route(name: str, args: Dict[str, Any]) -> str:
        result, _is_error, _handled = await client.handle_tool_call(name, args, session_id=session_id)
        return json.dumps(result, default=str)

    async def _discover(query: str, limit: int = 20) -> str:
        return await _route("discover", {"query": query, "limit": limit})

    async def _inspect(tool_ids: List[str], search_id: Optional[str] = None) -> str:
        return await _route("inspect", {"tool_ids": tool_ids, "search_id": search_id})

    async def _call(
        tool_id: str,
        params_to_tool: Dict[str, Any],
        search_id: Optional[str] = None,
        max_response_size: Optional[int] = None,
    ) -> str:
        args: Dict[str, Any] = {"tool_id": tool_id, "params_to_tool": params_to_tool}
        if search_id is not None:
            args["search_id"] = search_id
        if max_response_size is not None:
            args["max_response_size"] = max_response_size
        return await _route("call", args)

    return [
        Tool(
            _discover,
            takes_ctx=False,
            name="qveris_discover",
            description="Discover QVeris capabilities from a natural-language query. Free; returns candidates and a search_id.",
        ),
        Tool(
            _inspect,
            takes_ctx=False,
            name="qveris_inspect",
            description="Inspect one or more QVeris capabilities by tool_id before calling them. Free.",
        ),
        Tool(
            _call,
            takes_ctx=False,
            name="qveris_call",
            description="Call a selected QVeris capability with parameters. May consume credits.",
        ),
    ]
