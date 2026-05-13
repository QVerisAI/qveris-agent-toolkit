import json
from typing import Callable

import httpx
import pytest

from qveris.client.api import QverisClient
from qveris.config import QverisConfig


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
async def test_handle_tool_call_routes_canonical_and_legacy_builtin_tools() -> None:
    seen_requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen_requests.append((request.method, request.url.path, dict(request.url.params), body))

        if request.url.path == "/api/v1/search":
            return httpx.Response(
                200,
                json={
                    "search_id": "search-1",
                    "results": [{"tool_id": "weather.tool.v1", "name": "Weather"}],
                },
            )
        if request.url.path == "/api/v1/tools/by-ids":
            return httpx.Response(
                200,
                json={
                    "search_id": "search-1",
                    "results": [{"tool_id": "weather.tool.v1", "description": "Forecast"}],
                },
            )
        if request.url.path == "/api/v1/tools/execute":
            return httpx.Response(
                200,
                json={
                    "execution_id": "exec-1",
                    "success": True,
                    "result": {"temperature": 18},
                },
            )
        raise AssertionError(f"Unexpected path: {request.url.path}")

    client = make_client(handler)
    try:
        discover_result, is_error, handled = await client.handle_tool_call(
            "discover",
            {"query": "weather forecast", "limit": 1},
            session_id="session-1",
        )
        inspect_result, inspect_error, inspect_handled = await client.handle_tool_call(
            "get_tools_by_ids",
            {"tool_ids": ["weather.tool.v1"], "search_id": "search-1"},
            session_id="session-1",
        )
        call_result, call_error, call_handled = await client.handle_tool_call(
            "execute_tool",
            {
                "tool_id": "weather.tool.v1",
                "search_id": "search-1",
                "params_to_tool": '{"city":"London"}',
                "max_response_size": 4096,
            },
            session_id="session-1",
        )
        unknown_result, unknown_error, unknown_handled = await client.handle_tool_call(
            "local_tool",
            {},
            session_id="session-1",
        )
    finally:
        await client.close()

    assert (is_error, handled) == (False, True)
    assert discover_result["search_id"] == "search-1"
    assert (inspect_error, inspect_handled) == (False, True)
    assert inspect_result["results"][0]["tool_id"] == "weather.tool.v1"
    assert (call_error, call_handled) == (False, True)
    assert call_result["execution_id"] == "exec-1"
    assert (unknown_result, unknown_error, unknown_handled) == (None, False, False)

    assert seen_requests == [
        (
            "POST",
            "/api/v1/search",
            {},
            {"query": "weather forecast", "limit": 1, "session_id": "session-1"},
        ),
        (
            "POST",
            "/api/v1/tools/by-ids",
            {},
            {
                "tool_ids": ["weather.tool.v1"],
                "search_id": "search-1",
                "session_id": "session-1",
            },
        ),
        (
            "POST",
            "/api/v1/tools/execute",
            {"tool_id": "weather.tool.v1"},
            {
                "parameters": {"city": "London"},
                "search_id": "search-1",
                "session_id": "session-1",
                "max_response_size": 4096,
            },
        ),
    ]


@pytest.mark.asyncio
async def test_handle_tool_call_returns_structured_error_for_builtin_failures() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(402, text="not enough credits", request=request)

    client = make_client(handler)
    try:
        result, is_error, handled = await client.handle_tool_call(
            "call",
            {"tool_id": "tool-1", "search_id": "search-1", "params_to_tool": {"x": 1}},
        )
    finally:
        await client.close()

    assert handled is True
    assert is_error is True
    assert result == {"error": "HTTP 402: not enough credits"}
