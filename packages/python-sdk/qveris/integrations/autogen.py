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

from typing import Any, List, Optional

from ..client.api import QverisClient
from ._workflow import CALL_DESCRIPTION, DISCOVER_DESCRIPTION, INSPECT_DESCRIPTION, build_qveris_workflow

_INSTALL_HINT = (
    "The AutoGen integration requires Python >=3.10 and 'autogen-core'. "
    'Install them with: pip install "qveris[autogen]"'
)


def get_qveris_tools(
    client: QverisClient,
    *,
    session_id: Optional[str] = None,
) -> List[Any]:
    """Return AutoGen tools for the QVeris discover/inspect/call workflow.

    Args:
        client: The ``QverisClient`` to route calls through. You own its
            lifecycle — keep it open while the tools are in use and call
            ``await client.close()`` when done.
        session_id: Optional session id for correlation/pricing context.

    Returns:
        Three async AutoGen ``FunctionTool`` objects named
        ``qveris_discover``, ``qveris_inspect``, and ``qveris_call``.

    Raises:
        ImportError: if Python is older than 3.10 or ``autogen-core`` is not installed.
    """
    try:
        from autogen_core.tools import FunctionTool
    except ImportError as exc:  # pragma: no cover - exercised via install extras
        raise ImportError(_INSTALL_HINT) from exc

    workflow = build_qveris_workflow(client, session_id=session_id)

    return [
        FunctionTool(
            workflow.discover,
            name="qveris_discover",
            description=DISCOVER_DESCRIPTION,
        ),
        FunctionTool(
            workflow.inspect,
            name="qveris_inspect",
            description=INSPECT_DESCRIPTION,
        ),
        FunctionTool(
            workflow.call,
            name="qveris_call",
            description=CALL_DESCRIPTION,
        ),
    ]
