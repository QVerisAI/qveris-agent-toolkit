"""LangChain adapter for QVeris.

Exposes the QVeris ``discover`` / ``inspect`` / ``call`` workflow as LangChain
tools, so an agent built on LangChain (or LangGraph) can find and invoke
thousands of external capabilities through one QVeris API key.

    pip install "qveris[langchain]"

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

from typing import Any, List, Optional

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
    "The LangChain integration requires 'langchain-core'. Install it with: pip install \"qveris[langchain]\""
)


def get_qveris_tools(
    client: QverisClient,
    *,
    session_id: Optional[str] = None,
) -> List[Any]:
    """Return LangChain tools for the QVeris discover/inspect/call workflow.

    Args:
        client: The ``QverisClient`` to route calls through. You own its
            lifecycle — the tools hold a reference to it, so keep it open for
            as long as the tools are used and ``await client.close()`` when done.
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

    workflow = build_qveris_workflow(client, session_id=session_id)

    return [
        StructuredTool.from_function(
            coroutine=workflow.discover,
            name="qveris_discover",
            description=DISCOVER_DESCRIPTION,
            args_schema=DiscoverArgs,
        ),
        StructuredTool.from_function(
            coroutine=workflow.inspect,
            name="qveris_inspect",
            description=INSPECT_DESCRIPTION,
            args_schema=InspectArgs,
        ),
        StructuredTool.from_function(
            coroutine=workflow.call,
            name="qveris_call",
            description=CALL_DESCRIPTION,
            args_schema=CallArgs,
        ),
    ]
