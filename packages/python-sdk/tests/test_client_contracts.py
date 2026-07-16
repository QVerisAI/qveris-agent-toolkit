import json
from typing import Callable

import httpx
import pytest

from qveris.client import CALL_TOOL_DEF, DISCOVER_TOOL_DEF, INSPECT_TOOL_DEF
from qveris.client.api import QverisClient
from qveris.client.retry import RetryPolicy
from qveris.config import QverisConfig
from qveris.credentials import ApiKeyCredentialProvider, CredentialContext


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
async def test_api_key_provider_preserves_authorization_without_repr_leak() -> None:
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"search_id": "search-1", "results": []})

    client = make_client(handler)
    try:
        await client.discover("weather")
    finally:
        await client.close()

    assert requests[0].headers["Authorization"] == "Bearer sk-test"
    assert "sk-test" not in repr(ApiKeyCredentialProvider("sk-test"))


class RecordingCredentialProvider:
    def __init__(self, credential: str = "short-lived-token") -> None:
        self.credential = credential
        self.contexts = []

    async def get_credential(self, context: CredentialContext) -> str:
        self.contexts.append(context)
        return self.credential


@pytest.mark.asyncio
async def test_async_credential_provider_receives_api_resource() -> None:
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"search_id": "search-1", "results": []})

    provider = RecordingCredentialProvider()
    client = QverisClient(
        QverisConfig(api_key=None, base_url="https://custom.example/api/v1"),
        credential_provider=provider,
    )
    client.client = httpx.AsyncClient(
        base_url=client.base_url,
        headers=client.headers,
        transport=httpx.MockTransport(handler),
        timeout=60.0,
    )
    try:
        await client.discover("weather")
    finally:
        await client.close()

    assert provider.contexts == [CredentialContext(resource="https://custom.example/api/v1", scopes=())]
    assert requests[0].headers["Authorization"] == "Bearer short-lived-token"


def test_rejects_api_key_and_credential_provider_together() -> None:
    with pytest.raises(ValueError, match="either api_key or credential_provider"):
        QverisClient(QverisConfig(api_key="sk-test"), credential_provider=RecordingCredentialProvider())


def test_requires_api_key_or_credential_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("QVERIS_API_KEY", raising=False)
    with pytest.raises(ValueError, match="API key or credential_provider is required"):
        QverisClient(QverisConfig(api_key=None))


def test_rejects_credential_provider_without_get_credential() -> None:
    with pytest.raises(TypeError, match="credential_provider must implement get_credential"):
        QverisClient(QverisConfig(api_key=None), credential_provider=object())


@pytest.mark.asyncio
async def test_resolves_a_fresh_credential_for_each_retry_attempt() -> None:
    authorizations = []

    class RotatingCredentialProvider:
        def __init__(self) -> None:
            self.contexts = []

        async def get_credential(self, context: CredentialContext) -> str:
            self.contexts.append(context)
            return f"token-{len(self.contexts)}"

    def handler(request: httpx.Request) -> httpx.Response:
        authorizations.append(request.headers["Authorization"])
        if len(authorizations) == 1:
            return httpx.Response(429, json={"error": "rate limited"})
        return httpx.Response(200, json={"search_id": "search-1", "results": []})

    async def no_sleep(_delay: float) -> None:
        return None

    provider = RotatingCredentialProvider()
    client = QverisClient(QverisConfig(api_key=None), credential_provider=provider)
    client._retry = RetryPolicy(sleep=no_sleep, rng=lambda: 0.0)
    client.client = httpx.AsyncClient(
        base_url=client.base_url,
        headers=client.headers,
        transport=httpx.MockTransport(handler),
        timeout=60.0,
    )
    try:
        await client.discover("weather")
    finally:
        await client.close()

    expected_context = CredentialContext(resource="https://qveris.ai/api/v1", scopes=())
    assert provider.contexts == [expected_context, expected_context]
    assert authorizations == ["Bearer token-1", "Bearer token-2"]


@pytest.mark.asyncio
async def test_invalid_provider_credential_is_not_exposed() -> None:
    provider = RecordingCredentialProvider("secret-token\nforged-header")
    client = QverisClient(QverisConfig(api_key=None), credential_provider=provider)
    try:
        with pytest.raises(ValueError, match="invalid credential") as exc_info:
            await client.discover("weather")
    finally:
        await client.close()

    assert "secret-token" not in str(exc_info.value)


@pytest.mark.asyncio
async def test_provider_failure_text_is_not_exposed() -> None:
    class FailingCredentialProvider:
        async def get_credential(self, context: CredentialContext) -> str:
            raise RuntimeError("failed while handling secret-token")

    client = QverisClient(QverisConfig(api_key=None), credential_provider=FailingCredentialProvider())
    try:
        with pytest.raises(RuntimeError, match="failed to provide a credential") as exc_info:
            await client.discover("weather")
    finally:
        await client.close()

    assert "secret-token" not in str(exc_info.value)


def test_qveris_config_constructor_values_override_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("QVERIS_API_KEY", "sk-env")
    monkeypatch.setenv("QVERIS_BASE_URL", "https://env.example/api/v1")

    config = QverisConfig(api_key="sk-test", base_url="https://qveris.ai/api/v1")

    assert config.api_key == "sk-test"
    assert config.base_url == "https://qveris.ai/api/v1"
    assert "sk-test" not in repr(config)


def test_qveris_config_reads_env_when_no_init_value(monkeypatch: pytest.MonkeyPatch) -> None:
    # The env aliases must still populate the fields when no constructor value
    # is given (the other half of the init-precedence fix for #136).
    monkeypatch.setenv("QVERIS_API_KEY", "sk-env")
    monkeypatch.setenv("QVERIS_BASE_URL", "https://env.example/api/v1")

    config = QverisConfig()

    assert config.api_key == "sk-env"
    assert config.base_url == "https://env.example/api/v1"


def test_qveris_config_ignores_generic_env_names(monkeypatch: pytest.MonkeyPatch) -> None:
    # Only the QVERIS_-prefixed names are read from the environment. The generic
    # API_KEY / BASE_URL (very common for unrelated services) must NOT hijack the
    # config — a footgun if the field names were exposed as env aliases (#136).
    monkeypatch.delenv("QVERIS_API_KEY", raising=False)
    monkeypatch.delenv("QVERIS_BASE_URL", raising=False)
    monkeypatch.setenv("API_KEY", "sk-other-service")
    monkeypatch.setenv("BASE_URL", "https://some-other-app.local/")

    config = QverisConfig()

    assert config.api_key is None
    assert config.base_url == "https://qveris.ai/api/v1"


def test_qveris_config_does_not_infer_endpoint_from_key_or_region(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("QVERIS_BASE_URL", raising=False)
    monkeypatch.setenv("QVERIS_REGION", "cn")

    config = QverisConfig(api_key="sk-cn-test")

    assert config.base_url == "https://qveris.ai/api/v1"


def test_qveris_config_normalizes_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("QVERIS_BASE_URL", "https://env.example/api/v1///")

    assert QverisConfig().base_url == "https://env.example/api/v1"
    assert QverisConfig(base_url=" https://explicit.example/api/v1/ ").base_url == ("https://explicit.example/api/v1")


@pytest.mark.parametrize(
    "base_url",
    [
        "",
        "ftp://example.test/api/v1",
        "https:/example.test/api/v1",
        "https:example.test/api/v1",
        "https:///example.test/api/v1",
        "https://exa mple.test/api/v1",
        "https://example.test\\@other.test/api/v1",
        "https://user:pass@example.test/api/v1",
        "https://example.test/api/v1?mode=test",
        "https://example.test/api/v1?",
        "https://example.test/api/v1#section",
        "https://example.test/api/v1#",
    ],
)
def test_qveris_config_rejects_unsafe_base_url(base_url: str) -> None:
    with pytest.raises(ValueError, match="base URL"):
        QverisConfig(base_url=base_url)


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
                        "categories": [
                            {"slug": "weather", "name": "Weather", "description": "Weather related tools."},
                            "legacy-string-tag",
                        ],
                        "params": [
                            {
                                "name": "city",
                                "type": "string",
                                "required": True,
                                "description": {"en": "City name", "zh": "城市名称"},
                            }
                        ],
                        "capabilities": [
                            {
                                "id": "WX.FORECAST.DAILY",
                                "tag": [
                                    {
                                        "id": "US",
                                        "name": "United States",
                                        "type": "market",
                                        "description": "United States coverage.",
                                    }
                                ],
                            }
                        ],
                        "stats": {"avg_execution_time_ms": 42.5, "success_rate": 0.99},
                        "billing_rule": {
                            "metering_mode": "per_request",
                            "price": {"amount_credits": 3, "unit": "request"},
                        },
                        "expected_cost": "3.0",
                        "why_recommended": "Matched both semantic and keyword relevance signals.",
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
    categories = response.results[0].categories
    assert categories is not None
    assert categories[0].slug == "weather"
    assert categories[0].name == "Weather"
    assert categories[1] == "legacy-string-tag"
    capabilities = response.results[0].capabilities
    assert capabilities is not None
    assert capabilities[0].id == "WX.FORECAST.DAILY"
    assert capabilities[0].tag is not None
    assert capabilities[0].tag[0].id == "US"
    assert capabilities[0].tag[0].type == "market"
    assert response.results[0].expected_cost == "3.0"
    assert response.results[0].why_recommended == "Matched both semantic and keyword relevance signals."


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
                    "charge_lines": [{"component_key": "request", "amount_credits": 3, "unit": "request"}],
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
