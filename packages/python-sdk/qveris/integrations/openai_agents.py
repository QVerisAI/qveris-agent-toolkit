"""OpenAI Agents SDK adapter for QVeris.

Exposes the QVeris ``discover`` / ``inspect`` / ``call`` workflow as OpenAI
Agents SDK function tools, so an ``agents.Agent`` can find and invoke thousands
of external capabilities through one QVeris API key.

    pip install qveris[openai-agents]

    from agents import Agent, Runner
    from qveris import QverisClient
    from qveris.integrations.openai_agents import get_qveris_tools

    client = QverisClient()
    agent = Agent(name="Assistant", tools=get_qveris_tools(client))
    result = await Runner.run(agent, "Find a stock quote capability and quote AAPL.")
    await client.close()

Tool arguments and results mirror the built-in QVeris agent: discover returns a
``search_id`` that inspect/call thread through. Tools return JSON strings.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from ..client.api import QverisClient

_INSTALL_HINT = (
    "The OpenAI Agents integration requires 'openai-agents'. "
    "Install it with: pip install qveris[openai-agents]"
)


def get_qveris_tools(
    client: QverisClient,
    *,
    session_id: Optional[str] = None,
) -> List[Any]:
    """Return OpenAI Agents SDK function tools for the QVeris workflow.

    Args:
        client: The ``QverisClient`` to route calls through. You own its
            lifecycle — the tools hold a reference to it, so keep it open for
            as long as the tools are used and ``await client.close()`` when done.
        session_id: Optional session id for correlation/pricing context.

    Returns:
        A list of three ``FunctionTool`` objects named ``qveris_discover``,
        ``qveris_inspect``, and ``qveris_call``.

    Raises:
        ImportError: if ``openai-agents`` is not installed.
    """
    try:
        from agents import function_tool
    except ImportError as exc:  # pragma: no cover - exercised via install extras
        raise ImportError(_INSTALL_HINT) from exc

    async def _route(name: str, args: Dict[str, Any]) -> str:
        result, _is_error, _handled = await client.handle_tool_call(name, args, session_id=session_id)
        return json.dumps(result, default=str)

    @function_tool
    async def qveris_discover(query: str, limit: int = 20) -> str:
        """Discover QVeris capabilities from a natural-language query. Free.

        Args:
            query: Capability query in natural language, e.g. 'weather forecast API'.
            limit: Number of results to return (1-100).
        """
        return await _route("discover", {"query": query, "limit": limit})

    # strict_mode=False: these expose a free-form dict / optional params that a
    # strict JSON schema cannot represent.
    @function_tool(strict_mode=False)
    async def qveris_inspect(tool_ids: List[str], search_id: Optional[str] = None) -> str:
        """Inspect one or more QVeris capabilities by tool_id before calling them. Free.

        Args:
            tool_ids: Tool IDs returned by discover.
            search_id: The search_id from the discover response, if available.
        """
        return await _route("inspect", {"tool_ids": tool_ids, "search_id": search_id})

    @function_tool(strict_mode=False)
    async def qveris_call(
        tool_id: str,
        params_to_tool: Dict[str, Any],
        search_id: Optional[str] = None,
        max_response_size: Optional[int] = None,
    ) -> str:
        """Call a selected QVeris capability with parameters. May consume credits.

        Args:
            tool_id: The capability tool_id, from discover or inspect.
            params_to_tool: Parameters to pass to the capability.
            search_id: The search_id from the discover response, if available.
            max_response_size: Max response size in bytes; -1 means unlimited.
        """
        args: Dict[str, Any] = {
            "tool_id": tool_id,
            "params_to_tool": params_to_tool,
        }
        if search_id is not None:
            args["search_id"] = search_id
        if max_response_size is not None:
            args["max_response_size"] = max_response_size
        return await _route("call", args)

    return [qveris_discover, qveris_inspect, qveris_call]
