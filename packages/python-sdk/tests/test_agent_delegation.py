import asyncio
import base64
import json
from typing import List
from urllib.parse import parse_qs, quote_plus

import httpx
import pytest

from qveris.credentials import (
    AgentDelegationConstraints,
    AgentDelegationCredentialProvider,
    AgentDelegationError,
    CredentialContext,
)
from qveris import QverisClient, QverisConfig
from qveris.errors import QverisCredentialError


TOKEN_ENDPOINT = "https://qveris.ai/api/v1/oauth/token"
RESOURCE = "https://api.qveris.ai/tools"
CLIENT_ID = "agent runtime:id"
CLIENT_SECRET = "synthetic: client+secret"
SUBJECT_TOKEN = "synthetic-user-access-token"
DELEGATION_TOKEN = "synthetic-delegation-token"
CONTEXT = CredentialContext(
    resource="https://qveris.ai/api/v1",
    audience=RESOURCE,
    scopes=("tools.execute",),
    operation="call",
    purpose="paid_execution",
    session_id="session-1",
)


def token_payload(**overrides: object) -> dict[str, object]:
    return {
        "access_token": DELEGATION_TOKEN,
        "issued_token_type": "urn:ietf:params:oauth:token-type:access_token",
        "token_type": "Bearer",
        "expires_in": 600,
        "scope": "tools.execute",
        "resource": RESOURCE,
        "constraints": {
            "model": "model-a",
            "tool_ids": ["weather.tool.v1"],
            "run_id": "run-1",
            "max_credits": 10,
        },
        **overrides,
    }


class SubjectProvider:
    def __init__(self) -> None:
        self.contexts: List[CredentialContext] = []

    async def get_credential(self, context: CredentialContext) -> str:
        self.contexts.append(context)
        return SUBJECT_TOKEN


def build_provider(
    client: httpx.AsyncClient, subject: SubjectProvider | None = None
) -> AgentDelegationCredentialProvider:
    return AgentDelegationCredentialProvider(
        token_endpoint=TOKEN_ENDPOINT,
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        subject_credential_provider=subject or SubjectProvider(),
        resource=RESOURCE,
        scopes=("tools.inspect", "tools.execute"),
        constraints=AgentDelegationConstraints(
            model="model-a",
            tool_ids=("weather.tool.v1",),
            run_id="run-1",
            max_credits=25,
        ),
        http_client=client,
    )


def test_delegation_rejects_insecure_remote_token_endpoint() -> None:
    with pytest.raises(AgentDelegationError, match="HTTPS"):
        AgentDelegationCredentialProvider(
            token_endpoint="http://remote.example/token",
            client_id=CLIENT_ID,
            client_secret=CLIENT_SECRET,
            subject_credential_provider=SubjectProvider(),
            resource=RESOURCE,
            scopes=("tools.execute",),
        )


@pytest.mark.asyncio
async def test_client_preserves_safe_delegation_error_code() -> None:
    provider = AgentDelegationCredentialProvider(
        token_endpoint=TOKEN_ENDPOINT,
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        subject_credential_provider=SubjectProvider(),
        resource=RESOURCE,
        scopes=("tools.execute",),
    )
    client = QverisClient(
        QverisConfig(
            api_key=None,
            credential_audience="https://wrong.example",
            credential_scopes=("tools.execute",),
        ),
        credential_provider=provider,
    )
    try:
        with pytest.raises(QverisCredentialError) as captured:
            await client.call("weather.tool.v1", {})
    finally:
        await client.close()

    assert captured.value.code == "context_mismatch"
    assert captured.value.request_metadata.http_attempts == 0


@pytest.mark.asyncio
async def test_delegation_exchange_is_exact_cached_and_concurrency_safe() -> None:
    requests: List[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        await asyncio.sleep(0)
        expected_basic = base64.b64encode(f"{quote_plus(CLIENT_ID)}:{quote_plus(CLIENT_SECRET)}".encode()).decode()
        assert request.headers["authorization"] == f"Basic {expected_basic}"
        assert request.headers["content-type"].startswith("application/x-www-form-urlencoded")
        form = parse_qs(request.content.decode())
        assert form["grant_type"] == ["urn:ietf:params:oauth:grant-type:token-exchange"]
        assert form["subject_token"] == [SUBJECT_TOKEN]
        assert form["resource"] == [RESOURCE]
        assert form["scope"] == ["tools.execute"]
        assert form["tool_ids"] == ["weather.tool.v1"]
        assert form["model"] == ["model-a"]
        assert form["run_id"] == ["run-1"]
        assert form["max_credits"] == ["25"]
        return httpx.Response(200, json=token_payload())

    subject = SubjectProvider()
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = build_provider(client, subject)
        tokens = await asyncio.gather(*(provider.get_credential(CONTEXT) for _ in range(100)))
        assert tokens == [DELEGATION_TOKEN] * 100
        assert await provider.get_credential(CONTEXT) == DELEGATION_TOKEN

    assert len(requests) == 1
    assert subject.contexts == [CONTEXT] * 101


@pytest.mark.asyncio
async def test_delegation_cache_isolated_by_subject_credential() -> None:
    subject = SubjectProvider()
    subject.token = "subject-a"  # type: ignore[attr-defined]

    async def get_credential(context: CredentialContext) -> str:
        subject.contexts.append(context)
        return subject.token  # type: ignore[attr-defined]

    subject.get_credential = get_credential  # type: ignore[method-assign]

    async def handler(request: httpx.Request) -> httpx.Response:
        subject_token = parse_qs(request.content.decode())["subject_token"][0]
        return httpx.Response(200, json=token_payload(access_token=f"delegated-{subject_token}"))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = build_provider(client, subject)
        assert await provider.get_credential(CONTEXT) == "delegated-subject-a"
        subject.token = "subject-b"  # type: ignore[attr-defined]
        assert await provider.get_credential(CONTEXT) == "delegated-subject-b"


@pytest.mark.asyncio
async def test_delegation_applies_timeout_with_injected_http_client() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(1)
        return httpx.Response(200, json=token_payload())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=None) as client:
        provider = AgentDelegationCredentialProvider(
            token_endpoint=TOKEN_ENDPOINT,
            client_id=CLIENT_ID,
            client_secret=CLIENT_SECRET,
            subject_credential_provider=SubjectProvider(),
            resource=RESOURCE,
            scopes=("tools.execute",),
            http_client=client,
            exchange_timeout=0.01,
        )
        with pytest.raises(AgentDelegationError) as captured:
            await provider.get_credential(CONTEXT)

    assert captured.value.code == "token_exchange_failed"


@pytest.mark.asyncio
async def test_delegation_fails_closed_on_audience_and_scope_mismatch() -> None:
    requests = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        return httpx.Response(200, json=token_payload())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = build_provider(client)
        with pytest.raises(AgentDelegationError, match="audience") as audience_error:
            await provider.get_credential(CredentialContext(resource=CONTEXT.resource, scopes=CONTEXT.scopes))
        assert audience_error.value.code == "context_mismatch"

        with pytest.raises(AgentDelegationError, match="scope") as scope_error:
            await provider.get_credential(
                CredentialContext(resource=CONTEXT.resource, audience=RESOURCE, scopes=("admin",))
            )
        assert scope_error.value.code == "context_mismatch"

    assert requests == 0


@pytest.mark.asyncio
async def test_delegation_rejects_refresh_tokens_and_widened_constraints() -> None:
    responses = [
        token_payload(refresh_token="forbidden"),
        token_payload(
            constraints={
                "model": "model-a",
                "tool_ids": ["weather.tool.v1", "other.tool.v1"],
                "run_id": "run-1",
                "max_credits": 30,
            }
        ),
    ]

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=responses.pop(0))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(AgentDelegationError) as refresh_error:
            await build_provider(client).get_credential(CONTEXT)
        assert refresh_error.value.code == "invalid_token_response"

        with pytest.raises(AgentDelegationError) as widened_error:
            await build_provider(client).get_credential(CONTEXT)
        assert widened_error.value.code == "invalid_token_response"


@pytest.mark.asyncio
async def test_delegation_stops_streaming_oversized_token_responses() -> None:
    emitted: List[int] = []

    class OversizedStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            emitted.append(64 * 1024)
            yield b"x" * (64 * 1024)
            emitted.append(1)
            yield b"x"

        async def aclose(self) -> None:
            return None

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=OversizedStream())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(AgentDelegationError) as captured:
            await build_provider(client).get_credential(CONTEXT)

    assert captured.value.code == "invalid_token_response"
    assert emitted == [64 * 1024, 1]


@pytest.mark.asyncio
async def test_delegation_errors_do_not_include_credentials_or_response_body() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            content=json.dumps(
                {
                    "error": "invalid_client",
                    "error_description": f"{CLIENT_SECRET} {SUBJECT_TOKEN}",
                }
            ),
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(AgentDelegationError) as captured:
            await build_provider(client).get_credential(CONTEXT)

    error = captured.value
    assert error.code == "token_exchange_failed"
    assert error.status == 401
    serialized = f"{error!r} {error} {error.__dict__}"
    assert CLIENT_SECRET not in serialized
    assert SUBJECT_TOKEN not in serialized
