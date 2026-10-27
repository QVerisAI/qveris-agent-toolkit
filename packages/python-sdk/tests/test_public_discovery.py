import json
from uuid import uuid4

import httpx
import pytest

from qveris import PublicDiscoveryClient, PublicSearchResponse, QverisClient, QverisConfig
from qveris.errors import QverisApiError, QverisContractError

PUBLIC_ID = "pub_11111111-1111-4111-8111-111111111111"


def config(**kwargs):
    return QverisConfig(api_key=None, base_url="https://unit.test/api/v1", max_retries=0, **kwargs)


def public_body():
    return {"search_id": PUBLIC_ID, "contract_features": ["public-readonly-v1"], "results": [{"tool_id": "tool-a"}]}


@pytest.mark.asyncio
async def test_explicit_public_client_has_only_catalog_methods_and_never_reuses_cookies():
    requests = []

    def handler(request):
        requests.append(request)
        assert request.url.path in {"/api/v1/search", "/api/v1/tools/by-ids"}
        assert "authorization" not in request.headers and "cookie" not in request.headers
        assert request.headers["X-Qveris-Access-Mode"] == "public-readonly"
        return httpx.Response(200, json=public_body(), headers={"Set-Cookie": f"session={uuid4()}; Path=/"})

    async with PublicDiscoveryClient(config(), transport=httpx.MockTransport(handler)) as client:
        assert not hasattr(client, "call") and not hasattr(client, "probe")
        found = await client.discover(" weather ", view="routing")
        assert isinstance(found, PublicSearchResponse)
        assert "remaining_credits" not in found.model_dump()
        assert found.results[0].expected_cost is None
        assert found.results[0].billing_rule is None
        assert found.request_metadata.http_attempts == 1
        await client.inspect(found.results[0].tool_id, search_id=found.search_id, view="full")
    assert json.loads(requests[0].content) == {"query": "weather", "limit": 10, "view": "routing"}
    assert json.loads(requests[1].content) == {"tool_ids": ["tool-a"], "search_id": PUBLIC_ID, "view": "full"}


@pytest.mark.asyncio
async def test_missing_credentials_do_not_opt_in_and_mixed_configuration_never_resolves_credentials():
    with pytest.raises(ValueError, match="required"):
        QverisClient(config())
    for credential in ("", str(uuid4())):
        with pytest.raises(ValueError, match="cannot be combined"):
            PublicDiscoveryClient(QverisConfig(api_key=credential))

    class ExpiredCredential:
        async def get_credential(self, context):
            pytest.fail("Conflicting OAuth provider must not be read")

    with pytest.raises(ValueError, match="cannot be combined"):
        QverisClient(config(), credential_provider=ExpiredCredential(), public_read_only=True)
    async with httpx.AsyncClient() as borrowed:
        with pytest.raises(ValueError, match="independent HTTP client"):
            QverisClient(config(), http_client=borrowed, public_read_only=True)
        borrowed.headers["Authorization"] = ""
        with pytest.raises(ValueError, match="cannot be combined"):
            QverisClient(config(), http_client=borrowed, public_read_only=True)


@pytest.mark.asyncio
async def test_public_core_denies_private_operations_and_ambient_proofs_before_http():
    def forbidden(request):
        pytest.fail("Invalid public request must never reach HTTP")

    client = QverisClient(config(), public_read_only=True, transport=httpx.MockTransport(forbidden))
    try:
        for operation in (
            lambda: client.call("a", {}),
            lambda: client.probe("a"),
            lambda: client.usage(),
            lambda: client.ledger(),
        ):
            with pytest.raises(ValueError, match="only supports Discover and Inspect"):
                await operation()
        for name in (
            "Authorization",
            "Cookie",
            "Mcp-Session-Id",
            "X-Qveris-Trial-Session-Token",
            "X-Qveris-Credential-Context",
        ):
            client.client.headers[name] = ""
            with pytest.raises(ValueError, match="cannot be combined"):
                await client.discover("weather")
            del client.client.headers[name]
        client.config.api_key = str(uuid4())
        with pytest.raises(ValueError, match="cannot be combined"):
            await client.discover("weather")
        client.config.api_key = None
        client.client.cookies.set("session", str(uuid4()))
        with pytest.raises(ValueError, match="cannot be combined"):
            await client.discover("weather")
        client.client.cookies.clear()
        client.client.auth = httpx.BasicAuth(str(uuid4()), str(uuid4()))
        with pytest.raises(ValueError, match="cannot be combined"):
            await client.discover("weather")
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_public_inputs_are_bounded_and_private_or_empty_session_fields_are_rejected():
    def forbidden(request):
        pytest.fail("Invalid public request must never reach HTTP")

    client = QverisClient(config(), public_read_only=True, transport=httpx.MockTransport(forbidden))
    try:
        for kwargs in (
            {"query": " "},
            {"query": "x" * 1025},
            {"query": "x", "limit": 21},
            {"query": "x", "limit": True},
            {"query": "x", "session_id": ""},
            {"query": "x", "lang": "en"},
        ):
            with pytest.raises(ValueError):
                await client.discover(**kwargs)
        for ids in ([], ["a", "a"], ["x" * 256], list(map(str, range(11))), [str(i) + "😀" * 250 for i in range(10)]):
            with pytest.raises(ValueError):
                await client.inspect(ids)
        with pytest.raises(ValueError):
            await client.inspect(["a"], session_id="")
        for context in ("", "private-search"):
            with pytest.raises(ValueError):
                await client.inspect(["a"], search_id=context)
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_public_contract_failures_and_auth_failures_never_fall_back_or_create_an_account():
    bodies = [{"search_id": "private", "results": []}, {**public_body(), "remaining_credits": 0}]
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=bodies.pop(0))

    client = QverisClient(config(), public_read_only=True, transport=httpx.MockTransport(handler))
    try:
        for _ in range(2):
            with pytest.raises(QverisContractError):
                await client.discover("weather")
    finally:
        await client.close()
    assert len(requests) == 2

    def denied(request):
        requests.append(request)
        return httpx.Response(401, json={"message": "Authentication required"})

    for public in (True, False):
        cfg = config() if public else QverisConfig(api_key=str(uuid4()), base_url="https://unit.test/api/v1")
        client = QverisClient(cfg, public_read_only=public, transport=httpx.MockTransport(denied))
        try:
            with pytest.raises(QverisApiError) as error:
                await client.discover("weather")
            assert error.value.status == 401
        finally:
            await client.close()
    assert len(requests) == 4
    assert "x-qveris-access-mode" not in requests[-1].headers


@pytest.mark.asyncio
async def test_upgrade_preserves_selected_tool_and_input_requires_fresh_authenticated_context():
    requests = []

    def handler(request):
        requests.append(request)
        body = json.loads(request.content)
        if request.headers.get("x-qveris-access-mode"):
            return httpx.Response(200, json=public_body())
        if request.url.path.endswith("/tools/by-ids"):
            assert "search_id" not in body
            return httpx.Response(200, json={"search_id": "auth-search", "results": [{"tool_id": "tool-a"}]})
        if request.url.path.endswith("/tools/probe"):
            return httpx.Response(
                200,
                json={
                    "executable": True,
                    "schema": {"valid": True},
                    "quote": {"currency": "credits", "estimate_credits": 1, "exact": True},
                    "recovery": {
                        "missing_fields": [],
                        "safe_fixes": [],
                        "retryable": False,
                        "next_action": "execute",
                        "provider_fallback": False,
                    },
                },
            )
        assert body["search_id"] == "auth-search"
        assert body["parameters"] == {"city": "London"}
        return httpx.Response(200, json={"success": True, "execution_id": "synthetic-execution", "result": {}})

    async with PublicDiscoveryClient(config(), transport=httpx.MockTransport(handler)) as public:
        selected = (await public.discover("weather")).results[0]
    authenticated = QverisClient(
        QverisConfig(api_key=str(uuid4()), base_url="https://unit.test/api/v1"), transport=httpx.MockTransport(handler)
    )
    parameters = {"city": "London"}
    try:
        with pytest.raises(ValueError, match="Public context"):
            await authenticated.call(selected.tool_id, parameters, search_id=PUBLIC_ID)
        assert len(requests) == 1
        current = await authenticated.inspect(selected.tool_id)
        await authenticated.probe(selected.tool_id, parameters, checks=["schema", "quote"])
        await authenticated.call(current.results[0].tool_id, parameters, search_id=current.search_id)
        assert len(requests) == 4
        assert parameters == {"city": "London"}
    finally:
        await authenticated.close()
