"""Shared QVeris workflow used by all framework adapters."""

import json
from dataclasses import dataclass
from typing import Any, Callable, Coroutine, Dict, List, Optional

from pydantic import BaseModel, Field

from ..client.api import QverisClient

DISCOVER_DESCRIPTION = (
    "Discover QVeris capabilities from a natural-language query. Free; returns candidates and a search_id."
)
INSPECT_DESCRIPTION = "Inspect one or more QVeris capabilities by tool_id before calling them. Free."
CALL_DESCRIPTION = "Call a selected QVeris capability with parameters. May consume credits."

AsyncToolFunction = Callable[..., Coroutine[Any, Any, str]]


class DiscoverArgs(BaseModel):
    """Canonical discover parameters shared by schema-driven adapters."""

    query: str = Field(description="Capability query in natural language, e.g. 'weather forecast API'.")
    limit: int = Field(default=20, description="Number of results to return (1-100).")


class InspectArgs(BaseModel):
    """Canonical inspect parameters shared by schema-driven adapters."""

    tool_ids: List[str] = Field(description="Tool IDs returned by discover.")
    search_id: Optional[str] = Field(
        default=None, description="The search_id from the discover response, if available."
    )


class CallArgs(BaseModel):
    """Canonical call parameters shared by schema-driven adapters."""

    tool_id: str = Field(description="The capability tool_id, from discover or inspect.")
    params_to_tool: Dict[str, Any] = Field(description="Parameters to pass to the capability.")
    search_id: Optional[str] = Field(
        default=None, description="The search_id from the discover response, if available."
    )
    max_response_size: Optional[int] = Field(
        default=None, description="Max response size in bytes; -1 means unlimited."
    )


@dataclass(frozen=True)
class QverisWorkflow:
    """The three async functions shared by every framework adapter."""

    discover: AsyncToolFunction
    inspect: AsyncToolFunction
    call: AsyncToolFunction


def serialize_tool_result(result: Any) -> str:
    """Serialize mappings, Pydantic models, and fallback values as JSON."""
    model_dump = getattr(result, "model_dump", None)
    if callable(model_dump):
        try:
            result = model_dump(mode="json")
        except TypeError:  # Pydantic-like implementations without ``mode``
            result = model_dump()
    else:
        legacy_dict = getattr(result, "dict", None)
        if callable(legacy_dict):
            result = legacy_dict()
    return json.dumps(result, default=str)


def build_qveris_workflow(
    client: QverisClient,
    *,
    session_id: Optional[str] = None,
) -> QverisWorkflow:
    """Bind the canonical discover/inspect/call functions to a client."""

    async def _route(name: str, args: Dict[str, Any]) -> str:
        result, _is_error, _handled = await client.handle_tool_call(name, args, session_id=session_id)
        return serialize_tool_result(result)

    async def qveris_discover(query: str, limit: int = 20) -> str:
        """Discover QVeris capabilities from a natural-language query.

        :param query: Capability query in natural language, for example ``weather forecast API``.
        :param limit: Number of results to return (1-100).
        """
        return await _route("discover", {"query": query, "limit": limit})

    async def qveris_inspect(tool_ids: List[str], search_id: Optional[str] = None) -> str:
        """Inspect one or more QVeris capabilities before calling them.

        :param tool_ids: Tool IDs returned by discover.
        :param search_id: The search_id from the discover response, if available.
        """
        return await _route("inspect", {"tool_ids": tool_ids, "search_id": search_id})

    async def qveris_call(
        tool_id: str,
        params_to_tool: Dict[str, Any],
        search_id: Optional[str] = None,
        max_response_size: Optional[int] = None,
    ) -> str:
        """Call a selected QVeris capability with parameters.

        :param tool_id: The capability tool_id, from discover or inspect.
        :param params_to_tool: Parameters to pass to the capability.
        :param search_id: The search_id from the discover response, if available.
        :param max_response_size: Max response size in bytes; -1 means unlimited.
        """
        args: Dict[str, Any] = {"tool_id": tool_id, "params_to_tool": params_to_tool}
        if search_id is not None:
            args["search_id"] = search_id
        if max_response_size is not None:
            args["max_response_size"] = max_response_size
        return await _route("call", args)

    return QverisWorkflow(discover=qveris_discover, inspect=qveris_inspect, call=qveris_call)
