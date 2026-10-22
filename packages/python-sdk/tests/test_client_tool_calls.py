import json
from typing import Callable

import httpx
import pytest

from qveris.client.api import QverisClient
from qveris.config import QverisConfig
from qveris.errors import QverisApiError


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
async def test_call_idempotency_key_and_read_only_reconciliation():
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(
            {
                "method": request.method,
                "url": str(request.url),
                "idempotency_key": request.headers.get("Idempotency-Key"),
            }
        )
        if request.method == "POST":
            return httpx.Response(200, json={"execution_id": "exec-1", "success": True})
        return httpx.Response(
            200,
            json={
                "status": "success",
                "message": "ok",
                "data": {
                    "status": "completed",
                    "execution_id": "exec-1",
                    "execution_state": "completed",
                    "provider_request_dispatched": True,
                    "settlement_state": "settled",
                    "retry_disposition": "terminal",
                    "response": {"execution_id": "exec-1", "success": True},
                },
            },
        )

    client = make_client(handler)
    try:
        result = await client.call("tool-1", {}, idempotency_key="key-123")
        reconciled = await client.reconcile_call("key-123")
    finally:
        await client.close()

    assert result.execution_id == "exec-1"
    assert requests[0]["idempotency_key"] == "key-123"
    assert requests[0]["method"] == "POST"
    assert requests[1]["method"] == "GET"
    assert "/tools/executions/by-idempotency-key" in requests[1]["url"]
    assert "key=key-123" in requests[1]["url"]
    assert reconciled.status == "completed"
    assert reconciled.response["execution_id"] == "exec-1"


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["pending", "unavailable"])
async def test_reconciliation_null_response_is_read_only_without_polling(status):
    requests = []
    data = {
        "status": status,
        "execution_id": "exec-retained",
        "execution_state": "running" if status == "pending" else "completed",
        "provider_request_dispatched": True,
        "settlement_state": "pending",
        "retry_disposition": "reconcile_first",
        "response": None,
    }

    def handler(request):
        requests.append(
            {"method": request.method, "url": request.url, "headers": dict(request.headers), "content": request.content}
        )
        return httpx.Response(200, json={"status": "success", "data": data})

    client = make_client(handler)
    key = "original key+/=?"
    try:
        result = await client.reconcile_call(key)
    finally:
        await client.close()

    assert result.status == status
    assert result.response is None
    assert result.execution_id == data["execution_id"]
    assert result.settlement_state == data["settlement_state"]
    assert len(requests) == 1
    assert requests[0]["method"] == "GET"
    assert requests[0]["url"].params["key"] == key
    assert requests[0]["headers"]["authorization"] == "Bearer sk-test"
    assert requests[0]["content"] == b""


@pytest.mark.asyncio
async def test_conflicting_call_is_not_replayed_and_explicit_lookup_uses_original_key():
    requests = []

    def handler(request):
        requests.append(
            {"method": request.method, "url": request.url, "headers": dict(request.headers), "content": request.content}
        )
        if request.method == "POST":
            return httpx.Response(409, json={"message": "idempotency key conflict"})
        return httpx.Response(
            200,
            json={
                "status": "success",
                "data": {
                    "status": "completed",
                    "execution_id": "exec-original",
                    "execution_state": "completed",
                    "provider_request_dispatched": True,
                    "settlement_state": "settled",
                    "retry_disposition": "terminal",
                    "response": {"success": True, "execution_id": "exec-original"},
                },
            },
        )

    client = make_client(handler)
    key = "original-conflict-key"
    try:
        with pytest.raises(QverisApiError) as error:
            await client.call("tool", {}, idempotency_key=key)
        assert error.value.status == 409
        assert len(requests) == 1
        assert requests[0]["method"] == "POST"
        assert requests[0]["headers"]["idempotency-key"] == key

        result = await client.reconcile_call(key)
        assert result.execution_id == "exec-original"
        assert result.response["execution_id"] == "exec-original"
        assert len(requests) == 2
        assert requests[1]["method"] == "GET"
        assert requests[1]["url"].params["key"] == key
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_reconciliation_same_key_uses_each_clients_credentials_and_execution_identity():
    requests = []

    def handler(request):
        requests.append(
            {"method": request.method, "url": request.url, "headers": dict(request.headers), "content": request.content}
        )
        account = "a" if request.headers["Authorization"] == "Bearer account-a" else "b"
        return httpx.Response(
            200,
            json={
                "status": "success",
                "data": {
                    "status": "completed",
                    "execution_id": f"exec-{account}",
                    "execution_state": "completed",
                    "provider_request_dispatched": True,
                    "settlement_state": "settled",
                    "ledger_entry_id": f"ledger-{account}",
                    "retry_disposition": "terminal",
                    "response": {"success": True, "execution_id": f"exec-{account}"},
                },
            },
        )

    clients = []
    key = "same-caller-key"
    try:
        for account in ["a", "b"]:
            client = QverisClient(QverisConfig(api_key=f"account-{account}", base_url="https://qveris.ai/api/v1"))
            await client.client.aclose()
            client.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
            clients.append(client)
            result = await client.reconcile_call(key)
            assert result.execution_id == f"exec-{account}"
            assert result.ledger_entry_id == f"ledger-{account}"
        assert len(requests) == 2
        for request, account in zip(requests, ["a", "b"]):
            assert request["method"] == "GET"
            assert request["url"].params["key"] == key
            assert request["headers"]["authorization"] == f"Bearer account-{account}"
    finally:
        for client in clients:
            await client.close()


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
    assert result == {
        "error": "Payment Required",
        "status": 402,
        "code": None,
        "operation": "call",
        "http_attempts": 1,
    }
