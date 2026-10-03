"""Shared QVeris workflow used by all framework adapters."""

import json
from dataclasses import dataclass
from typing import Any, Callable, Coroutine, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from ..client.api import QverisClient

DISCOVER_DESCRIPTION = (
    "Discover QVeris capabilities from a natural-language query. Free; returns candidates and a search_id. "
    "Provider comparison: Inspect each candidate to confirm current scope/contracts. If a budget decision requires a "
    "current Probe cost quote, do not Call until the host obtains it; this three-tool adapter does not expose Probe. "
    "This does not apply to fresh business data such as a stock quote; obtain that with Call."
)
INSPECT_DESCRIPTION = (
    "Inspect one or more QVeris capabilities by tool_id before calling them. Provider comparison: Inspect each candidate "
    "to confirm current scope/contracts. If a budget decision requires a current Probe cost quote, do not Call until the "
    "host obtains it; this three-tool adapter does not expose Probe. This does not apply to fresh business data such as "
    "a stock quote; obtain that with Call. Free."
)
CALL_DESCRIPTION = (
    "Call a selected QVeris capability with parameters. Reuse only exact routes; rebuild current parameters and Call "
    "again for current/latest/today/time-sensitive data. May consume credits."
)

PROBE_DESCRIPTION = (
    "Optionally validate parameters or obtain a current schema/quote without executing a capability. Free. "
    "A quote does not reserve price or authorize execution; coverage/sample may be unknown."
)


def probe_guidance(description: str, include_probe: bool) -> str:
    if include_probe:
        return description.replace(
            "do not Call until the host obtains it; this three-tool adapter does not expose Probe.",
            "use qveris_probe to obtain it before Call.",
        )
    return description


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


class ProbeArgs(BaseModel):
    tool_id: str = Field(description="Capability tool ID.")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Candidate capability parameters.")
    checks: List[Literal["schema", "quote", "coverage", "sample"]] = Field(
        default=["schema"], description="Checks to run without capability execution."
    )
    live_budget: Literal["none", "metadata", "sampled"] = Field(
        default="none", description="Probe metadata budget; does not authorize execution."
    )


@dataclass(frozen=True)
class QverisWorkflow:
    """Core workflow functions and the optional Probe shared by framework adapters."""

    discover: AsyncToolFunction
    inspect: AsyncToolFunction
    call: AsyncToolFunction
    probe: AsyncToolFunction


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
    model: Optional[str] = None,
    sub_user_id: Optional[str] = None,
    include_probe: bool = False,
) -> QverisWorkflow:
    """Bind the canonical workflow functions to a client."""

    if sub_user_id is not None and (not isinstance(sub_user_id, str) or not sub_user_id.strip()):
        raise ValueError("sub_user_id must be a non-empty host-controlled identity.")

    async def _route(name: str, args: Dict[str, Any]) -> str:
        result, _is_error, _handled = await client.handle_tool_call(
            name,
            args,
            session_id=session_id,
            **({"sub_user_id": sub_user_id} if name == "call" and sub_user_id is not None else {}),
        )
        return serialize_tool_result(result)

    async def qveris_discover(query: str, limit: int = 20) -> str:
        """Discover QVeris capabilities from a natural-language query.

        Provider comparison: Inspect each candidate to confirm current scope/contracts. If a budget decision requires a
        current Probe cost quote, do not Call until the host obtains it; this three-tool adapter does not expose Probe.
        This does not apply to fresh business data such as a stock quote; obtain that with Call.

        :param query: Capability query in natural language, for example ``weather forecast API``.
        :param limit: Number of results to return (1-100).
        """
        return await _route("discover", {"query": query, "limit": limit})

    async def qveris_inspect(tool_ids: List[str], search_id: Optional[str] = None) -> str:
        """Inspect one or more QVeris capabilities before calling them.

        Provider comparison: Inspect each candidate to confirm current scope/contracts. If a budget decision requires a
        current Probe cost quote, do not Call until the host obtains it; this three-tool adapter does not expose Probe.
        This does not apply to fresh business data such as a stock quote; obtain that with Call.

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

        Reuse only exact routes; rebuild current parameters and Call again for current/latest/today/time-sensitive data.

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
        if model is not None:
            args["model"] = model
        return await _route("call", args)

    async def qveris_probe(
        tool_id: str,
        parameters: Optional[Dict[str, Any]] = None,
        checks: Optional[List[Literal["schema", "quote", "coverage", "sample"]]] = None,
        live_budget: Literal["none", "metadata", "sampled"] = "none",
    ) -> str:
        """Validate parameters or obtain a quote without executing a capability.

        :param tool_id: Capability tool ID.
        :param parameters: Candidate capability parameters.
        :param checks: Non-executing checks to run.
        :param live_budget: Probe metadata budget; does not authorize execution.
        """
        result = await client.probe(
            tool_id,
            parameters=parameters,
            checks=checks,
            live_budget=live_budget,
            **({"sub_user_id": sub_user_id} if sub_user_id is not None else {}),
            **({"correlation_id": session_id} if session_id is not None else {}),
        )
        return serialize_tool_result(result)

    if include_probe:
        qveris_discover.__doc__ = probe_guidance(qveris_discover.__doc__ or "", True)
        qveris_inspect.__doc__ = probe_guidance(qveris_inspect.__doc__ or "", True)
    return QverisWorkflow(discover=qveris_discover, inspect=qveris_inspect, call=qveris_call, probe=qveris_probe)
