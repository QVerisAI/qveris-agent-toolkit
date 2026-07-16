"""OpenAI Agents SDK adapter for QVeris.

Exposes the QVeris ``discover`` / ``inspect`` / ``call`` workflow as OpenAI
Agents SDK function tools, so an ``agents.Agent`` can find and invoke thousands
of external capabilities through one QVeris API key.

    pip install "qveris[openai-agents]"

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

from typing import Any, List, Optional

from ..client.api import QverisClient
from ._workflow import build_qveris_workflow

_INSTALL_HINT = (
    "The OpenAI Agents integration requires 'openai-agents'. Install it with: pip install \"qveris[openai-agents]\""
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

    workflow = build_qveris_workflow(client, session_id=session_id)

    # strict_mode=False: these expose a free-form dict / optional params that a
    # strict JSON schema cannot represent.
    return [
        function_tool(workflow.discover),
        function_tool(workflow.inspect, strict_mode=False),
        function_tool(workflow.call, strict_mode=False),
    ]
