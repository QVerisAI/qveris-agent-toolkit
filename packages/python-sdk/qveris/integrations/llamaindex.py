"""LlamaIndex adapter for QVeris.

Exposes the QVeris ``discover`` / ``inspect`` / ``call`` workflow as native
LlamaIndex ``FunctionTool`` objects.

    pip install "qveris[llamaindex]"

The tools are async and return JSON strings. Pass them to ``FunctionAgent`` or
another LlamaIndex agent, and close the QVeris client when finished.
"""

from functools import wraps
from typing import Any, Callable, List, Optional

from ..client.api import QverisClient
from ._workflow import (
    CALL_DESCRIPTION,
    DISCOVER_DESCRIPTION,
    INSPECT_DESCRIPTION,
    CallArgs,
    DiscoverArgs,
    InspectArgs,
    build_qveris_workflow,
)

_INSTALL_HINT = (
    "The LlamaIndex integration requires Python >=3.10 and 'llama-index-core'. "
    'Install them with: pip install "qveris[llamaindex]"'
)
_SYNC_ERROR = (
    "QVeris LlamaIndex tools are async-only because QverisClient owns a persistent async HTTP client. "
    "Use 'await tool.acall(...)' or an async LlamaIndex agent instead of 'tool.call(...)'."
)


def _reject_sync_call(async_fn: Callable[..., Any]) -> Callable[..., str]:
    """Preserve an async tool's schema while rejecting LlamaIndex's sync path."""

    @wraps(async_fn)
    def sync_guard(*args: Any, **kwargs: Any) -> str:
        raise RuntimeError(_SYNC_ERROR)

    return sync_guard


def get_qveris_tools(
    client: QverisClient,
    *,
    session_id: Optional[str] = None,
) -> List[Any]:
    """Return LlamaIndex tools for the QVeris discover/inspect/call workflow.

    Args:
        client: The ``QverisClient`` to route calls through. You own its
            lifecycle — keep it open while the tools are in use and call
            ``await client.close()`` when done.
        session_id: Optional session id for correlation/pricing context.

    Returns:
        Three async LlamaIndex ``FunctionTool`` objects named
        ``qveris_discover``, ``qveris_inspect``, and ``qveris_call``. Their
        synchronous ``call`` path raises with guidance to use ``acall``.

    Raises:
        ImportError: if Python is older than 3.10 or ``llama-index-core`` is not installed.
    """
    try:
        from llama_index.core.tools import FunctionTool
    except ImportError as exc:  # pragma: no cover - exercised via install extras
        raise ImportError(_INSTALL_HINT) from exc

    workflow = build_qveris_workflow(client, session_id=session_id)

    return [
        FunctionTool.from_defaults(
            fn=_reject_sync_call(workflow.discover),
            async_fn=workflow.discover,
            name="qveris_discover",
            description=DISCOVER_DESCRIPTION,
            fn_schema=DiscoverArgs,
        ),
        FunctionTool.from_defaults(
            fn=_reject_sync_call(workflow.inspect),
            async_fn=workflow.inspect,
            name="qveris_inspect",
            description=INSPECT_DESCRIPTION,
            fn_schema=InspectArgs,
        ),
        FunctionTool.from_defaults(
            fn=_reject_sync_call(workflow.call),
            async_fn=workflow.call,
            name="qveris_call",
            description=CALL_DESCRIPTION,
            fn_schema=CallArgs,
        ),
    ]
