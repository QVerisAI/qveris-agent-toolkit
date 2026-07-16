"""Shared conformance suite for the framework adapters.

Every adapter must expose the same
QVeris workflow with the same semantics. Each adapter's test module subclasses
:class:`AdapterConformance`, implements the two hooks, and inherits the full
invariant suite — so a semantic drift in one adapter (e.g. an argument that is
optional in three adapters but required in the fourth) fails its tests instead
of shipping. Modeled on the ``langchain-tests`` standard-tests pattern.

Invariants covered:

1. ``get_qveris_tools(client, session_id=...)`` returns exactly three tools
   named ``qveris_discover`` / ``qveris_inspect`` / ``qveris_call``, in that
   order, each with a non-empty description.
2. The client is a required argument.
3. ``discover`` routes to ``handle_tool_call("discover", {query, limit})`` and
   threads ``session_id``.
4. ``inspect`` passes ``tool_ids`` (+ ``search_id``).
5. ``call`` threads ``tool_id``/``search_id``/``params_to_tool``, and OMITS
   ``search_id`` and ``max_response_size`` from the request when not provided.
6. Tool results are JSON strings of the client payload.
"""

import asyncio
import json
from typing import Any, Dict, List, Optional, Tuple

import pytest
from pydantic import BaseModel

EXPECTED_TOOL_PARAMS = {
    "qveris_discover": {"query", "limit"},
    "qveris_inspect": {"tool_ids", "search_id"},
    "qveris_call": {"tool_id", "params_to_tool", "search_id", "max_response_size"},
}


class FakeClient:
    """Records handle_tool_call invocations and returns canned payloads."""

    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []

    async def handle_tool_call(
        self, func_name: str, func_args: Dict[str, Any], session_id: Optional[str] = None
    ) -> Tuple[Any, bool, bool]:
        self.calls.append({"name": func_name, "args": func_args, "session_id": session_id})
        if func_name == "discover":
            return {"search_id": "s1", "results": [{"tool_id": "t1"}]}, False, True
        if func_name == "inspect":
            return {"results": [{"tool_id": "t1", "name": "T"}]}, False, True
        return {"execution_id": "e1", "success": True}, False, True


def run(coro: Any) -> Any:
    """Run a coroutine from a sync test (adapters may also be natively sync)."""
    return asyncio.run(coro)


class AdapterConformance:
    """Inherit and implement :meth:`make_tools` and :meth:`invoke`."""

    def make_tools(self, client: Any, session_id: Optional[str] = None) -> List[Any]:
        """Return the adapter's tools for ``client`` (its get_qveris_tools)."""
        raise NotImplementedError

    def invoke(self, tool: Any, args: Dict[str, Any]) -> str:
        """Invoke ``tool`` with ``args`` and return its raw (string) result."""
        raise NotImplementedError

    def make_tools_no_client(self) -> Any:
        """Call the adapter's get_qveris_tools with no arguments."""
        raise NotImplementedError

    def tool_name(self, tool: Any) -> str:
        """Return a framework tool's public name."""
        return tool.name

    def tool_description(self, tool: Any) -> str:
        """Return a framework tool's public description."""
        return tool.description

    def tool_schema(self, tool: Any) -> Dict[str, Any]:
        """Return a framework tool's JSON parameter schema."""
        return tool.args_schema.model_json_schema()

    # -- helpers ---------------------------------------------------------

    def tool(self, tools: List[Any], name: str) -> Any:
        return next(t for t in tools if self.tool_name(t) == name)

    # -- invariants ------------------------------------------------------

    def test_exposes_three_named_tools_in_order(self) -> None:
        tools = self.make_tools(FakeClient())
        assert [self.tool_name(t) for t in tools] == ["qveris_discover", "qveris_inspect", "qveris_call"]
        for t in tools:
            assert self.tool_description(t), f"{self.tool_name(t)} must have a description"

    def test_client_is_required(self) -> None:
        with pytest.raises(TypeError):
            self.make_tools_no_client()

    def test_tool_schemas_expose_described_canonical_parameters(self) -> None:
        for tool in self.make_tools(FakeClient()):
            name = self.tool_name(tool)
            properties = self.tool_schema(tool).get("properties", {})
            assert set(properties) == EXPECTED_TOOL_PARAMS[name]
            for parameter, schema in properties.items():
                assert schema.get("description"), f"{name}.{parameter} must have a description"

    def test_discover_routes_and_threads_session_id(self) -> None:
        client = FakeClient()
        discover = self.tool(self.make_tools(client, session_id="sess-1"), "qveris_discover")

        out = self.invoke(discover, {"query": "weather forecast API", "limit": 3})

        assert client.calls == [
            {"name": "discover", "args": {"query": "weather forecast API", "limit": 3}, "session_id": "sess-1"}
        ]
        assert isinstance(out, str), "adapters must return JSON strings"
        assert json.loads(out)["search_id"] == "s1"

    def test_pydantic_results_are_serialized_as_json_objects(self) -> None:
        class Payload(BaseModel):
            search_id: str
            results: List[Dict[str, str]]

        class ModelClient(FakeClient):
            async def handle_tool_call(
                self, func_name: str, func_args: Dict[str, Any], session_id: Optional[str] = None
            ) -> Tuple[Any, bool, bool]:
                return Payload(search_id="s-model", results=[{"tool_id": "t-model"}]), False, True

        discover = self.tool(self.make_tools(ModelClient()), "qveris_discover")
        output = json.loads(self.invoke(discover, {"query": "weather", "limit": 1}))

        assert output == {"search_id": "s-model", "results": [{"tool_id": "t-model"}]}

    def test_inspect_passes_tool_ids_and_search_id(self) -> None:
        client = FakeClient()
        inspect = self.tool(self.make_tools(client), "qveris_inspect")

        self.invoke(inspect, {"tool_ids": ["t1", "t2"], "search_id": "s1"})

        assert client.calls[0]["name"] == "inspect"
        assert client.calls[0]["args"] == {"tool_ids": ["t1", "t2"], "search_id": "s1"}

    def test_call_threads_ids_and_omits_absent_max_response_size(self) -> None:
        client = FakeClient()
        call = self.tool(self.make_tools(client), "qveris_call")

        out = self.invoke(call, {"tool_id": "t1", "search_id": "s1", "params_to_tool": {"city": "London"}})

        assert client.calls[0]["name"] == "call"
        assert client.calls[0]["args"] == {
            "tool_id": "t1",
            "search_id": "s1",
            "params_to_tool": {"city": "London"},
        }
        assert "max_response_size" not in client.calls[0]["args"]
        assert json.loads(out)["execution_id"] == "e1"

    def test_call_omits_absent_search_id(self) -> None:
        client = FakeClient()
        call = self.tool(self.make_tools(client), "qveris_call")

        self.invoke(call, {"tool_id": "t1", "params_to_tool": {}})

        assert client.calls[0]["args"] == {"tool_id": "t1", "params_to_tool": {}}
        assert "search_id" not in client.calls[0]["args"]

    def test_call_forwards_max_response_size_when_given(self) -> None:
        client = FakeClient()
        call = self.tool(self.make_tools(client), "qveris_call")

        self.invoke(
            call,
            {"tool_id": "t1", "search_id": "s1", "params_to_tool": {}, "max_response_size": 2048},
        )

        assert client.calls[0]["args"]["max_response_size"] == 2048
