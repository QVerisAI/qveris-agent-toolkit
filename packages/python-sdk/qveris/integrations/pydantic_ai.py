"""Pydantic AI adapter for QVeris.

Exposes the QVeris ``discover`` / ``inspect`` / ``call`` workflow as native
Pydantic AI ``Tool`` objects.

    pip install "qveris[pydantic-ai]"

The tools are async and return JSON strings. Pass them to ``Agent(tools=...)``
and close the QVeris client when finished.
"""

from __future__ import annotations

from typing import Any, List, Optional

from ..client.api import QverisClient
from ._workflow import CALL_DESCRIPTION, DISCOVER_DESCRIPTION, INSPECT_DESCRIPTION, build_qveris_workflow

_INSTALL_HINT = (
    "The Pydantic AI integration requires Python >=3.10 and 'pydantic-ai-slim'. "
    'Install them with: pip install "qveris[pydantic-ai]"'
)


def get_qveris_tools(
    client: QverisClient,
    *,
    session_id: Optional[str] = None,
) -> List[Any]:
    """Return Pydantic AI tools for the QVeris discover/inspect/call workflow.

    Args:
        client: The ``QverisClient`` to route calls through. You own its
            lifecycle — keep it open while the tools are in use and call
            ``await client.close()`` when done.
        session_id: Optional session id for correlation/pricing context.

    Returns:
        Three async Pydantic AI ``Tool`` objects named ``qveris_discover``,
        ``qveris_inspect``, and ``qveris_call``.

    Raises:
        ImportError: if Python is older than 3.10 or ``pydantic-ai-slim`` is not installed.
    """
    try:
        from pydantic_ai import Tool
    except ImportError as exc:  # pragma: no cover - exercised via install extras
        raise ImportError(_INSTALL_HINT) from exc

    workflow = build_qveris_workflow(client, session_id=session_id)

    return [
        Tool(
            workflow.discover,
            takes_ctx=False,
            name="qveris_discover",
            description=DISCOVER_DESCRIPTION,
            require_parameter_descriptions=True,
        ),
        Tool(
            workflow.inspect,
            takes_ctx=False,
            name="qveris_inspect",
            description=INSPECT_DESCRIPTION,
            require_parameter_descriptions=True,
        ),
        Tool(
            workflow.call,
            takes_ctx=False,
            name="qveris_call",
            description=CALL_DESCRIPTION,
            require_parameter_descriptions=True,
        ),
    ]
