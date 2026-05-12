import json
from typing import Callable

import httpx
import pytest

from qveris.agent.core import Agent
from qveris.client import (
    CALL_TOOL_DEF,
    DISCOVER_TOOL_DEF,
    EXECUTE_TOOL_DEF,
    GET_TOOLS_BY_IDS_TOOL_DEF,
    INSPECT_TOOL_DEF,
    SEARCH_TOOL_DEF,
)
from qveris.client.api import QverisClient
from qveris.config import QverisConfig
from qveris.types import ChatResponse


class DummyLLMProvider:
    async def chat(self, messages, tools, config):
        return ChatResponse(content="ok")

    async def chat_stream(self, messages, tools, config):
        if False:
            yield


def make_client(handler: Callable[[httpx.Request], httpx.Response]) -> QverisClient:
    client = QverisClient(QverisConfig(api_key="sk-test", base_url="https://qveris.ai/api/v1"))
    client.client = httpx.AsyncClient(
        base_url=client.base_url,
        headers=client.headers,
        transport=httpx.MockTransport(handler),
        timeout=60.0,
    )
    return client


@pytest.mark.asyncio
async def test_inspect_accepts_list_and_single_tool_id() -> None:
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "search_id": "search-1",
                "results": [{"tool_id": "weather.tool.v1", "description": "Weather"}],
            },
        )

    client = make_client(handler)
    try:
        await client.inspect(["weather.tool.v1"], search_id="search-1", session_id="session-1")
        await client.inspect("weather.tool.v1")
    finally:
        await client.close()

    assert requests == [
        {
            "tool_ids": ["weather.tool.v1"],
            "search_id": "search-1",
            "session_id": "session-1",
        },
        {"tool_ids": ["weather.tool.v1"]},
    ]


@pytest.mark.asyncio
async def test_handle_tool_call_supports_inspect_alias_and_object_params() -> None:
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append((request.url.path, dict(request.url.params), body))
        if request.url.path == "/api/v1/tools/by-ids":
            return httpx.Response(
                200,
            json={"results": [{"tool_id": "weather.tool.v1", "description": "Weather"}]},
            )
        return httpx.Response(
            200,
            json={"execution_id": "exec-1", "success": True, "result": {"ok": True}},
        )

    client = make_client(handler)
    try:
        inspect_result, inspect_error, inspect_handled = await client.handle_tool_call(
            "get_tools_by_ids",
            {"tool_ids": ["weather.tool.v1"], "search_id": "search-1"},
            session_id="session-1",
        )
        call_result, call_error, call_handled = await client.handle_tool_call(
            "call",
            {
                "tool_id": "weather.tool.v1",
                "search_id": "search-1",
                "params_to_tool": {"city": "London"},
            },
            session_id="session-1",
        )
    finally:
        await client.close()

    assert (inspect_error, inspect_handled) == (False, True)
    assert inspect_result["results"][0]["tool_id"] == "weather.tool.v1"
    assert (call_error, call_handled) == (False, True)
    assert call_result["execution_id"] == "exec-1"
    assert seen == [
        (
            "/api/v1/tools/by-ids",
            {},
            {
                "tool_ids": ["weather.tool.v1"],
                "search_id": "search-1",
                "session_id": "session-1",
            },
        ),
        (
            "/api/v1/tools/execute",
            {"tool_id": "weather.tool.v1"},
            {
                "parameters": {"city": "London"},
                "search_id": "search-1",
                "session_id": "session-1",
            },
        ),
    ]


@pytest.mark.asyncio
async def test_agent_and_exports_include_inspect_tool() -> None:
    agent = Agent(config=QverisConfig(api_key="sk-test"), llm_provider=DummyLLMProvider())
    try:
        assert [tool["function"]["name"] for tool in agent.tools] == ["discover", "inspect", "call"]
        assert DISCOVER_TOOL_DEF["function"]["name"] == "discover"
        assert INSPECT_TOOL_DEF["function"]["name"] == "inspect"
        assert CALL_TOOL_DEF["function"]["name"] == "call"
        assert SEARCH_TOOL_DEF is DISCOVER_TOOL_DEF
        assert GET_TOOLS_BY_IDS_TOOL_DEF is INSPECT_TOOL_DEF
        assert EXECUTE_TOOL_DEF is CALL_TOOL_DEF
    finally:
        await agent.close()
