import asyncio
import json
from pathlib import Path
from typing import Any, Dict, List

import httpx
import pytest

from qveris.client.api import QverisClient
from qveris.client.retry import RetryPolicy
from qveris.config import QverisConfig
from qveris.credentials import CredentialContext
from qveris.errors import (
    QverisApiError,
    QverisClientClosedError,
    QverisTransportError,
)
from qveris.types import ExecuteResultTruncated, ToolExecutionResponse


SYNTHETIC_TOKEN = "synthetic-credential-value-273"
PAID_CALL_POLICY = json.loads(
    (Path(__file__).parents[3] / "test-fixtures" / "paid-call-policy.json").read_text(encoding="utf-8")
)


def call_success() -> Dict[str, Any]:
    return PAID_CALL_POLICY["contract_fixtures"]["n"]["body"]


def make_client(handler, *, debug_callback=None, max_retries: int = 3) -> QverisClient:
    return QverisClient(
        QverisConfig(api_key=SYNTHETIC_TOKEN, max_retries=max_retries),
        debug_callback=debug_callback,
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("status", PAID_CALL_POLICY["read_operations"]["retryable_statuses"])
async def test_paid_call_never_retries_retryable_statuses(status: int) -> None:
    requests: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status, json={"message": "try again"})

    client = make_client(handler)
    client._retry = RetryPolicy(sleep=lambda _delay: asyncio.sleep(0))
    try:
        with pytest.raises(QverisApiError) as exc_info:
            await client.call("paid-tool", {})
    finally:
        await client.close()

    assert len(requests) == PAID_CALL_POLICY["paid_call"]["expected_http_attempts"]
    assert exc_info.value.status == status
    assert exc_info.value.request_metadata.http_attempts == 1
    assert exc_info.value.request_metadata.retry_attempts == 0


@pytest.mark.asyncio
async def test_paid_call_strict_mode_does_not_replay_unsupported_projection() -> None:
    requests: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        fixture = PAID_CALL_POLICY["contract_fixtures"]["n_minus_1"]
        return httpx.Response(fixture["status"], json=fixture["body"])

    client = make_client(handler)
    try:
        with pytest.raises(QverisApiError) as exc_info:
            await client.call("paid-tool", {}, respond_with="summary")
    finally:
        await client.close()

    assert len(requests) == 1
    assert exc_info.value.request_metadata.http_attempts == 1
    assert exc_info.value.request_metadata.compatibility_replays == 0


@pytest.mark.asyncio
async def test_paid_call_does_not_replay_unauthorized_response() -> None:
    requests: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(401, json={"message": "credential rejected"})

    client = make_client(handler)
    try:
        with pytest.raises(QverisApiError) as exc_info:
            await client.call("paid-tool", {})
    finally:
        await client.close()

    assert len(requests) == PAID_CALL_POLICY["paid_call"]["expected_http_attempts"]
    assert exc_info.value.status == 401


@pytest.mark.asyncio
async def test_paid_call_legacy_mode_replays_once_and_marks_metadata() -> None:
    requests: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if len(requests) == 1:
            fixture = PAID_CALL_POLICY["contract_fixtures"]["n_minus_1"]
        else:
            fixture = PAID_CALL_POLICY["contract_fixtures"]["n"]
        return httpx.Response(fixture["status"], json=fixture["body"])

    client = make_client(handler)
    try:
        with pytest.warns(DeprecationWarning, match="may resubmit"):
            response = await client.call(
                "paid-tool",
                {},
                respond_with="summary",
                compatibility_mode="legacy_optional_fields",
            )
    finally:
        await client.close()

    assert len(requests) == 2
    assert "respond_with" in json.loads(requests[0].content)
    assert "respond_with" not in json.loads(requests[1].content)
    assert response.request_metadata is not None
    assert response.request_metadata.http_attempts == 2
    assert response.request_metadata.retry_attempts == 0
    assert response.request_metadata.compatibility_replays == 1
    assert "request_metadata" not in response.model_dump()


@pytest.mark.asyncio
async def test_transport_error_drops_request_exception_context_and_secret_locals() -> None:
    requests: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        raise httpx.ReadTimeout("synthetic transport failure", request=request)

    client = make_client(handler)
    try:
        with pytest.raises(QverisTransportError) as exc_info:
            await client.call("paid-tool", {})
    finally:
        await client.close()

    error = exc_info.value
    assert len(requests) == 1
    assert error.__cause__ is None
    assert error.__context__ is None
    assert not hasattr(error, "request")
    assert not hasattr(error, "response")
    assert SYNTHETIC_TOKEN not in repr(error)
    assert SYNTHETIC_TOKEN not in str(error)

    traceback = error.__traceback__
    while traceback is not None:
        for value in traceback.tb_frame.f_locals.values():
            assert SYNTHETIC_TOKEN not in repr(value)
        traceback = traceback.tb_next


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error_factory",
    [
        lambda request: httpx.ConnectError("dns or tls connect failed", request=request),
        lambda request: httpx.ConnectTimeout("connect timed out", request=request),
        lambda request: httpx.ReadError("read failed", request=request),
        lambda request: httpx.ReadTimeout("read timed out", request=request),
        lambda request: httpx.WriteError("write failed", request=request),
        lambda request: httpx.WriteTimeout("write timed out", request=request),
        lambda request: httpx.PoolTimeout("pool timed out", request=request),
    ],
)
async def test_paid_call_transport_failures_are_single_submit(error_factory) -> None:
    requests: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        raise error_factory(request)

    client = make_client(handler)
    try:
        with pytest.raises(QverisTransportError):
            await client.call("paid-tool", {})
    finally:
        await client.close()

    assert len(requests) == PAID_CALL_POLICY["paid_call"]["expected_http_attempts"]


@pytest.mark.asyncio
async def test_paid_call_cancellation_preserves_cancellation_without_replay() -> None:
    started = asyncio.Event()

    class BlockingTransport(httpx.AsyncBaseTransport):
        def __init__(self) -> None:
            self.attempts = 0

        async def handle_async_request(self, _request: httpx.Request) -> httpx.Response:
            self.attempts += 1
            started.set()
            await asyncio.Event().wait()
            raise AssertionError("unreachable")

    transport = BlockingTransport()
    client = QverisClient(QverisConfig(api_key=SYNTHETIC_TOKEN), transport=transport)
    task = asyncio.create_task(client.call("paid-tool", {}))
    await started.wait()
    task.cancel()
    try:
        with pytest.raises(asyncio.CancelledError) as exc_info:
            await task
    finally:
        await client.close()

    assert transport.attempts == PAID_CALL_POLICY["paid_call"]["expected_http_attempts"]
    assert exc_info.value.__cause__ is None
    assert SYNTHETIC_TOKEN not in repr(exc_info.value.__context__)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 403, 429, 503])
async def test_debug_and_api_error_details_redact_credentials_and_signed_urls(status: int) -> None:
    debug: List[str] = []
    embedded_signed_url = "https://files.example/result?X-Amz-Signature=embedded-secret"
    selection_token = "opaque-selection-secret-273"

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status,
            json={
                "message": f"Rejected Bearer {SYNTHETIC_TOKEN}; inspect {embedded_signed_url}",
                "authorization": f"Bearer {SYNTHETIC_TOKEN}",
                "full_content_file_url": "https://files.example/result?X-Amz-Signature=secret",
                "selectionToken": selection_token,
            },
        )

    client = make_client(handler, debug_callback=debug.append)
    try:
        with pytest.raises(QverisApiError) as exc_info:
            await client.call("paid-tool", {})
    finally:
        await client.close()

    rendered = repr(exc_info.value.details) + "\n" + "\n".join(debug)
    assert SYNTHETIC_TOKEN not in rendered
    assert "X-Amz-Signature=secret" not in rendered
    assert "X-Amz-Signature=embedded-secret" not in rendered
    assert selection_token not in rendered
    assert exc_info.value.details["authorization"] == "***"
    assert exc_info.value.details["full_content_file_url"] == "***"
    assert exc_info.value.details["selectionToken"] == "***"

    traceback = exc_info.value.__traceback__
    while traceback is not None:
        for value in traceback.tb_frame.f_locals.values():
            if isinstance(value, httpx.Response):
                assert SYNTHETIC_TOKEN not in value.text
                assert "X-Amz-Signature=secret" not in value.text
                assert value.request.headers["Authorization"] == "Bearer ***"
        traceback = traceback.tb_next


@pytest.mark.asyncio
async def test_credential_context_is_operation_aware_and_concurrent_tokens_do_not_cross() -> None:
    contexts: List[CredentialContext] = []

    class ContextCredentialProvider:
        async def get_credential(self, context: CredentialContext) -> str:
            contexts.append(context)
            await asyncio.sleep(0)
            return f"token-{context.correlation_id}"

    def handler(request: httpx.Request) -> httpx.Response:
        query = json.loads(request.content)["query"]
        assert request.headers["Authorization"] == f"Bearer token-{query}"
        return httpx.Response(200, json={"search_id": query, "results": []})

    provider = ContextCredentialProvider()
    client = QverisClient(
        QverisConfig(
            api_key=None,
            credential_audience="qveris-api",
            credential_scopes=("tools.read",),
        ),
        credential_provider=provider,
        transport=httpx.MockTransport(handler),
    )
    try:
        await asyncio.gather(
            *(client.discover(f"request-{index}", correlation_id=f"request-{index}") for index in range(100))
        )
    finally:
        await client.close()

    assert len(contexts) == 100
    assert {context.correlation_id for context in contexts} == {f"request-{index}" for index in range(100)}
    assert all(context.operation == "discover" for context in contexts)
    assert all(context.purpose == "data_read" for context in contexts)
    assert all(context.audience == "qveris-api" for context in contexts)
    assert all(context.scopes == ("tools.read",) for context in contexts)


@pytest.mark.asyncio
async def test_child_tasks_keep_credential_context_and_authorization_isolated() -> None:
    contexts: Dict[str, CredentialContext] = {}

    class ChildTaskCredentialProvider:
        async def get_credential(self, context: CredentialContext) -> str:
            assert context.correlation_id is not None
            contexts[context.correlation_id] = context
            await asyncio.sleep(0)
            return f"child-token-{context.correlation_id}"

    def handler(request: httpx.Request) -> httpx.Response:
        query = json.loads(request.content)["query"]
        assert request.headers["Authorization"] == f"Bearer child-token-{query}"
        return httpx.Response(200, json={"search_id": query, "results": []})

    client = QverisClient(
        QverisConfig(api_key=None),
        credential_provider=ChildTaskCredentialProvider(),
        transport=httpx.MockTransport(handler),
    )

    async def parent(parent_id: str) -> None:
        child_ids = [f"{parent_id}-child-{index}" for index in range(5)]
        child_tasks = [
            asyncio.create_task(client.discover(child_id, correlation_id=child_id)) for child_id in child_ids
        ]
        await asyncio.gather(*child_tasks)

    try:
        await asyncio.gather(*(parent(f"parent-{index}") for index in range(10)))
    finally:
        await client.close()

    expected_ids = {
        f"parent-{parent_index}-child-{child_index}" for parent_index in range(10) for child_index in range(5)
    }
    assert set(contexts) == expected_ids
    assert all(context.correlation_id == correlation_id for correlation_id, context in contexts.items())
    assert all(context.operation == "discover" for context in contexts.values())


@pytest.mark.asyncio
async def test_paid_call_credential_context_includes_purpose_and_safe_references() -> None:
    contexts: List[CredentialContext] = []

    class RecordingProvider:
        async def get_credential(self, context: CredentialContext) -> str:
            contexts.append(context)
            return "short-lived-token"

    client = QverisClient(
        QverisConfig(api_key=None),
        credential_provider=RecordingProvider(),
        transport=httpx.MockTransport(lambda _request: httpx.Response(200, json=call_success())),
    )
    try:
        await client.call(
            "paid-tool",
            {},
            session_id="session-1",
            correlation_id="correlation-1",
        )
    finally:
        await client.close()

    assert contexts == [
        CredentialContext(
            resource="https://qveris.ai/api/v1",
            operation="call",
            purpose="paid_execution",
            session_id="session-1",
            correlation_id="correlation-1",
        )
    ]


@pytest.mark.asyncio
async def test_http_timeout_starts_after_credential_acquisition_and_is_operation_specific() -> None:
    timeouts: List[Dict[str, float]] = []

    class SlowCredentialProvider:
        async def get_credential(self, _context: CredentialContext) -> str:
            await asyncio.sleep(0.01)
            return "short-lived-token"

    def handler(request: httpx.Request) -> httpx.Response:
        timeouts.append(request.extensions["timeout"])
        if request.url.path.endswith("/search"):
            return httpx.Response(200, json={"search_id": "search-1", "results": []})
        return httpx.Response(200, json=call_success())

    client = QverisClient(
        QverisConfig(api_key=None, read_timeout=7, call_timeout=11),
        credential_provider=SlowCredentialProvider(),
        transport=httpx.MockTransport(handler),
    )
    try:
        await client.discover("weather")
        await client.call("paid-tool", {}, timeout=13)
    finally:
        await client.close()

    assert timeouts[0] == {"connect": 7.0, "read": 7.0, "write": 7.0, "pool": 7.0}
    assert timeouts[1] == {"connect": 13.0, "read": 13.0, "write": 13.0, "pool": 13.0}


@pytest.mark.asyncio
async def test_shared_client_is_not_closed_and_close_rejects_new_requests() -> None:
    shared = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(200, json={"search_id": "search-1", "results": []})
        )
    )
    client = QverisClient(QverisConfig(api_key=SYNTHETIC_TOKEN), http_client=shared)
    await asyncio.gather(client.close(), client.close())

    assert not shared.is_closed
    with pytest.raises(QverisClientClosedError):
        await client.discover("weather")
    with pytest.raises(QverisClientClosedError):
        await client.inspect([])
    await shared.aclose()


@pytest.mark.asyncio
async def test_owned_client_close_waits_for_inflight_request_and_closes_once() -> None:
    started = asyncio.Event()
    release = asyncio.Event()

    class CountingTransport(httpx.AsyncBaseTransport):
        def __init__(self) -> None:
            self.close_count = 0

        async def handle_async_request(self, _request: httpx.Request) -> httpx.Response:
            started.set()
            await release.wait()
            return httpx.Response(200, json={"search_id": "search-1", "results": []})

        async def aclose(self) -> None:
            self.close_count += 1

    transport = CountingTransport()
    client = QverisClient(QverisConfig(api_key=SYNTHETIC_TOKEN), transport=transport)
    request_task = asyncio.create_task(client.discover("weather"))
    await started.wait()
    close_tasks = [asyncio.create_task(client.close()), asyncio.create_task(client.close())]
    await asyncio.sleep(0)
    assert not any(task.done() for task in close_tasks)

    release.set()
    await request_task
    await asyncio.gather(*close_tasks)

    assert transport.close_count == 1


@pytest.mark.asyncio
async def test_cancelling_owned_transport_close_finishes_close_and_keeps_state_consistent() -> None:
    close_started = asyncio.Event()
    release_close = asyncio.Event()

    class BlockingCloseTransport(httpx.AsyncBaseTransport):
        def __init__(self) -> None:
            self.close_count = 0

        async def handle_async_request(self, _request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"search_id": "search-1", "results": []})

        async def aclose(self) -> None:
            self.close_count += 1
            close_started.set()
            await release_close.wait()

    transport = BlockingCloseTransport()
    client = QverisClient(QverisConfig(api_key=SYNTHETIC_TOKEN), transport=transport)
    close_task = asyncio.create_task(client.close())
    await close_started.wait()

    close_task.cancel()
    await asyncio.sleep(0)
    assert not close_task.done()

    release_close.set()
    with pytest.raises(asyncio.CancelledError):
        await close_task

    assert transport.close_count == 1
    with pytest.raises(QverisClientClosedError):
        await client.discover("weather")
    await client.close()


@pytest.mark.asyncio
async def test_owned_transport_close_failure_still_seals_client_state() -> None:
    class FailingCloseTransport(httpx.AsyncBaseTransport):
        def __init__(self) -> None:
            self.close_count = 0

        async def handle_async_request(self, _request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"search_id": "search-1", "results": []})

        async def aclose(self) -> None:
            self.close_count += 1
            raise RuntimeError("synthetic close failure")

    transport = FailingCloseTransport()
    client = QverisClient(QverisConfig(api_key=SYNTHETIC_TOKEN), transport=transport)

    with pytest.raises(RuntimeError, match="synthetic close failure"):
        await client.close()

    assert transport.close_count == 1
    with pytest.raises(QverisClientClosedError):
        await client.discover("weather")
    await client.close()
    assert transport.close_count == 1


def test_signed_url_is_serialized_but_excluded_from_repr() -> None:
    signed_url = "https://files.example/result?X-Amz-Signature=secret"
    truncated = ExecuteResultTruncated(
        message="truncated",
        full_content_file_url=signed_url,
        truncated_content="preview",
    )
    response = ToolExecutionResponse(
        execution_id="exec-1",
        success=True,
        result={"full_content_file_url": signed_url},
    )

    assert truncated.model_dump()["full_content_file_url"] == signed_url
    assert signed_url not in repr(truncated)
    assert response.model_dump()["result"]["full_content_file_url"] == signed_url
    assert signed_url not in repr(response)
