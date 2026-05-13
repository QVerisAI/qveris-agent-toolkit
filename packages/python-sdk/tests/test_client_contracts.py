import json
from typing import Callable

import httpx
import pytest

from qveris.client import CALL_TOOL_DEF, DISCOVER_TOOL_DEF, INSPECT_TOOL_DEF
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
async def test_discover_contract_parses_tool_quality_and_billing() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/api/v1/search"
        assert json.loads(request.content) == {"query": "weather forecast API", "limit": 3}
        return httpx.Response(
            200,
            json={
                "search_id": "search-123",
                "total": 1,
                "results": [
                    {
                        "tool_id": "weather.forecast.v1",
                        "name": "Weather Forecast",
                        "description": "Forecast by location",
                        "provider_name": "Weather",
                        "params": [
                            {
                                "name": "city",
                                "type": "string",
                                "required": True,
                                "description": {"en": "City name", "zh": "城市名称"},
                            }
                        ],
                        "stats": {"avg_execution_time_ms": 42.5, "success_rate": 0.99},
                        "billing_rule": {
                            "metering_mode": "per_request",
                            "price": {"amount_credits": 3, "unit": "request"},
                        },
                    }
                ],
                "elapsed_time_ms": 12.5,
            },
        )

    client = make_client(handler)
    try:
        response = await client.discover("weather forecast API", limit=3)
    finally:
        await client.close()

    assert response.search_id == "search-123"
    assert response.results[0].tool_id == "weather.forecast.v1"
    assert response.results[0].stats is not None
    assert response.results[0].params is not None
    assert response.results[0].params[0].description == {"en": "City name", "zh": "城市名称"}
    assert response.results[0].stats.success_rate == 0.99
    assert response.results[0].billing_rule is not None
    assert response.results[0].billing_rule.price is not None
    assert response.results[0].billing_rule.price.amount_credits == 3


@pytest.mark.asyncio
async def test_inspect_contract_posts_tool_ids() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/api/v1/tools/by-ids"
        assert json.loads(request.content) == {"tool_ids": ["weather.forecast.v1"], "search_id": "search-123"}
        return httpx.Response(
            200,
            json={
                "search_id": "search-123",
                "results": [{"tool_id": "weather.forecast.v1", "description": "Forecast"}],
            },
        )

    client = make_client(handler)
    try:
        response = await client.inspect(["weather.forecast.v1"], search_id="search-123")
    finally:
        await client.close()

    assert response.results[0].tool_id == "weather.forecast.v1"


@pytest.mark.asyncio
async def test_inspect_empty_tool_ids_returns_empty_response_without_request() -> None:
    requested = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal requested
        requested = True
        return httpx.Response(500, json={"error": f"unexpected request to {request.url.path}"})

    client = make_client(handler)
    try:
        response = await client.inspect([], search_id="search-123")
    finally:
        await client.close()

    assert requested is False
    assert response.search_id == "search-123"
    assert response.total == 0
    assert response.results == []


@pytest.mark.asyncio
async def test_call_contract_parses_execution_outcome_and_billing() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/api/v1/tools/execute"
        assert request.url.params["tool_id"] == "weather.forecast.v1"
        assert json.loads(request.content) == {
            "parameters": {"city": "London"},
            "search_id": "search-123",
            "max_response_size": 20480,
        }
        return httpx.Response(
            200,
            json={
                "execution_id": "exec-123",
                "tool_id": "weather.forecast.v1",
                "parameters": {"city": "London"},
                "success": True,
                "result": {"data": {"temperature": 18}},
                "elapsed_time_ms": 210.5,
                "billing": {
                    "summary": "3 credits per successful request",
                    "list_amount_credits": 3,
                    "charge_lines": [
                        {"component_key": "request", "amount_credits": 3, "unit": "request"}
                    ],
                },
                "remaining_credits": 997,
            },
        )

    client = make_client(handler)
    try:
        response = await client.call(
            "weather.forecast.v1",
            parameters={"city": "London"},
            search_id="search-123",
            max_response_size=20480,
        )
    finally:
        await client.close()

    assert response.execution_id == "exec-123"
    assert response.success is True
    assert response.billing is not None
    assert response.billing.list_amount_credits == 3
    assert response.billing.charge_lines is not None
    assert response.billing.charge_lines[0].component_key == "request"


@pytest.mark.asyncio
async def test_post_methods_unwrap_success_envelopes() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/search":
            return httpx.Response(
                200,
                json={"status": "success", "data": {"search_id": "search-123", "results": [], "total": 0}},
            )
        if request.url.path == "/api/v1/tools/by-ids":
            return httpx.Response(
                200,
                json={
                    "status": "success",
                    "data": {
                        "search_id": "search-123",
                        "results": [{"tool_id": "weather.forecast.v1", "description": "Forecast"}],
                    },
                },
            )
        if request.url.path == "/api/v1/tools/execute":
            return httpx.Response(
                200,
                json={
                    "status": "success",
                    "data": {
                        "execution_id": "exec-123",
                        "success": True,
                        "tool_id": "weather.forecast.v1",
                    },
                },
            )
        raise AssertionError(f"Unexpected path: {request.url.path}")

    client = make_client(handler)
    try:
        discover_response = await client.discover("weather forecast API")
        inspect_response = await client.inspect("weather.forecast.v1", search_id="search-123")
        call_response = await client.call("weather.forecast.v1", parameters={})
    finally:
        await client.close()

    assert discover_response.search_id == "search-123"
    assert inspect_response.results[0].tool_id == "weather.forecast.v1"
    assert call_response.execution_id == "exec-123"


@pytest.mark.asyncio
async def test_failure_envelope_raises_before_model_parsing() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"status": "failure", "message": "quota exhausted", "data": {"unexpected": "shape"}},
        )

    client = make_client(handler)
    try:
        with pytest.raises(RuntimeError, match="quota exhausted"):
            await client.discover("weather forecast API")
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_usage_contract_unwraps_envelope_and_filters() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/api/v1/auth/usage/history/v2"
        assert request.url.params["execution_id"] == "exec-123"
        assert request.url.params["summary"] == "true"
        return httpx.Response(
            200,
            json={
                "status": "success",
                "data": {
                    "items": [
                        {
                            "id": "usage-1",
                            "event_type": "tool_execute",
                            "source_system": "qveris",
                            "success": True,
                            "charge_outcome": "charged",
                            "execution_id": "exec-123",
                            "actual_amount_credits": 3,
                            "created_at": "2026-05-10T00:00:00Z",
                        }
                    ],
                    "total": 1,
                    "page": 1,
                    "page_size": 1,
                    "summary": {"total_credits": 3},
                },
            },
        )

    client = make_client(handler)
    try:
        response = await client.usage(execution_id="exec-123", summary=True)
    finally:
        await client.close()

    assert response.total == 1
    assert response.items[0].charge_outcome == "charged"
    assert response.summary == {"total_credits": 3}


@pytest.mark.asyncio
async def test_ledger_contract_unwraps_envelope_and_filters() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/api/v1/auth/credits/ledger"
        assert request.url.params["direction"] == "consume"
        assert request.url.params["min_credits"] == "1.5"
        return httpx.Response(
            200,
            json={
                "status": "success",
                "data": {
                    "items": [
                        {
                            "id": "ledger-1",
                            "entry_type": "consume_tool_execute",
                            "amount_credits": -3,
                            "source_system": "qveris",
                            "source_ref_type": "execution",
                            "source_ref_id": "exec-123",
                            "created_at": "2026-05-10T00:00:00Z",
                        }
                    ],
                    "total": 1,
                    "page": 1,
                    "page_size": 1,
                    "summary": {"net_credits": -3},
                },
            },
        )

    client = make_client(handler)
    try:
        response = await client.ledger(direction="consume", min_credits=1.5, summary=True)
    finally:
        await client.close()

    assert response.total == 1
    assert response.items[0].entry_type == "consume_tool_execute"
    assert response.summary == {"net_credits": -3}


@pytest.mark.asyncio
async def test_account_audit_debug_logs_include_get_url_headers_and_body() -> None:
    debug_logs = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/auth/usage/history/v2":
            return httpx.Response(
                200,
                json={"items": [], "total": 0, "page": 1, "page_size": 0},
            )
        if request.url.path == "/api/v1/auth/credits/ledger":
            return httpx.Response(
                200,
                json={"items": [], "total": 0, "page": 1, "page_size": 0},
            )
        raise AssertionError(f"Unexpected path: {request.url.path}")

    client = make_client(handler)
    client.debug_callback = debug_logs.append
    try:
        await client.usage(execution_id="exec-123", summary=True)
        await client.ledger(direction="consume", summary=True)
    finally:
        await client.close()

    joined = "\n".join(debug_logs)
    assert "[Qveris API] GET https://qveris.ai/api/v1/auth/usage/history/v2" in joined
    assert "[Qveris API] GET https://qveris.ai/api/v1/auth/credits/ledger" in joined
    assert '"Authorization": "Bearer ***"' in joined
    assert "sk-test" not in joined
    assert "[Qveris API] Response body:" in joined


def test_canonical_tool_definitions_are_exported() -> None:
    assert DISCOVER_TOOL_DEF["function"]["name"] == "discover"
    assert INSPECT_TOOL_DEF["function"]["name"] == "inspect"
    assert CALL_TOOL_DEF["function"]["name"] == "call"
