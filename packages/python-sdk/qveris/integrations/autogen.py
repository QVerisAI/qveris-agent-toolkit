"""AutoGen adapter for QVeris.

Exposes the QVeris ``discover`` / ``inspect`` / ``call`` workflow as AutoGen
``FunctionTool`` objects.

    pip install "qveris[autogen]"

    from qveris import QverisClient
    from qveris.integrations.autogen import get_qveris_tools

    client = QverisClient()
    tools = get_qveris_tools(client)
    # pass `tools` to an AutoGen agent, then `await client.close()` when done

The tools are async and return JSON strings. A discover response's
``search_id`` can be threaded through inspect and call.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from ..client.api import QverisClient

_INSTALL_HINT = "The AutoGen integration requires 'autogen-core'. Install it with: pip install \"qveris[autogen]\""


def get_qveris_tools(
    client: QverisClient,
    *,
    session_id: Optional[str] = None,
) -> List[Any]:
    """Return AutoGen tools for the QVeris discover/inspect/call workflow."""
    try:
        from autogen_core.tools import FunctionTool
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
        FunctionTool(
            _discover,
            name="qveris_discover",
            description="Discover QVeris capabilities from a natural-language query. Free; returns candidates and a search_id.",
        ),
        FunctionTool(
            _inspect,
            name="qveris_inspect",
            description="Inspect one or more QVeris capabilities by tool_id before calling them. Free.",
            strict=False,
        ),
        FunctionTool(
            _call,
            name="qveris_call",
            description="Call a selected QVeris capability with parameters. May consume credits.",
            strict=False,
        ),
    ]
