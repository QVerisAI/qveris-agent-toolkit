import json
from typing import Callable

import httpx
import pytest

pytest.importorskip("opentelemetry", reason="observability tests require qveris[otel]")

from opentelemetry.sdk.trace import TracerProvider  # noqa: E402
from opentelemetry.sdk.trace.export import SimpleSpanProcessor  # noqa: E402
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter  # noqa: E402

from qveris import observability  # noqa: E402
from qveris.client.api import QverisClient  # noqa: E402
from qveris.config import QverisConfig  # noqa: E402


def make_client(handler: Callable[[httpx.Request], httpx.Response]) -> QverisClient:
    client = QverisClient(QverisConfig(api_key="sk-test", base_url="https://qveris.ai/api/v1"))
    client.client = httpx.AsyncClient(
        base_url=client.base_url,
        headers=client.headers,
        transport=httpx.MockTransport(handler),
        timeout=60.0,
    )
    return client


@pytest.fixture()
def spans(monkeypatch: pytest.MonkeyPatch) -> InMemorySpanExporter:
    """Route qveris spans into an isolated in-memory exporter for the test."""
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setattr(observability, "_tracer", provider.get_tracer("qveris-test"))
    return exporter


def _span_by_name(exporter: InMemorySpanExporter, name: str):
    return next(s for s in exporter.get_finished_spans() if s.name == name)


@pytest.mark.asyncio
async def test_discover_emits_span_with_attributes(spans: InMemorySpanExporter) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "search_id": "s1",
                "total": 2,
                "results": [{"tool_id": "t1"}, {"tool_id": "t2"}],
                "elapsed_time_ms": 12.5,
            },
        )

    client = make_client(handler)
    try:
        await client.discover("weather", limit=5, session_id="sess-1")
    finally:
        await client.close()

    span = _span_by_name(spans, "qveris.discover")
    attrs = dict(span.attributes)
    assert attrs["qveris.operation"] == "discover"
    assert attrs["qveris.limit"] == 5
    assert attrs["qveris.session_id"] == "sess-1"
    assert attrs["qveris.search_id"] == "s1"
    assert attrs["qveris.result_count"] == 2
    assert attrs["qveris.elapsed_time_ms"] == 12.5
    # The natural-language query must NOT be recorded.
    assert "weather" not in json.dumps(attrs)


@pytest.mark.asyncio
async def test_call_emits_span_with_execution_id_and_credits(spans: InMemorySpanExporter) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "execution_id": "exec-9",
                "tool_id": "t1",
                "success": True,
                "elapsed_time_ms": 210.5,
                "billing": {"summary": "3 credits", "list_amount_credits": 3},
            },
        )

    client = make_client(handler)
    try:
        await client.call("t1", {"city": "London"}, search_id="s1")
    finally:
        await client.close()

    attrs = dict(_span_by_name(spans, "qveris.call").attributes)
    assert attrs["qveris.operation"] == "call"
    assert attrs["qveris.tool_id"] == "t1"
    assert attrs["qveris.search_id"] == "s1"
    assert attrs["qveris.execution_id"] == "exec-9"
    assert attrs["qveris.success"] is True
    assert attrs["qveris.elapsed_time_ms"] == 210.5
    assert attrs["qveris.credits"] == 3


@pytest.mark.asyncio
async def test_call_span_marked_error_on_http_failure(spans: InMemorySpanExporter) -> None:
    from opentelemetry.trace import StatusCode

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    client = make_client(handler)
    try:
        with pytest.raises(httpx.HTTPStatusError):
            await client.call("t1", {}, search_id="s1")
    finally:
        await client.close()

    span = _span_by_name(spans, "qveris.call")
    assert span.status.status_code == StatusCode.ERROR


@pytest.mark.asyncio
async def test_broken_tracer_does_not_break_the_call(monkeypatch: pytest.MonkeyPatch) -> None:
    # A misbehaving tracer provider must never break the traced operation.
    class BrokenTracer:
        def start_as_current_span(self, *args, **kwargs):
            raise RuntimeError("sampler exploded")

    monkeypatch.setattr(observability, "_tracer", BrokenTracer())

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"execution_id": "e1", "success": True})

    client = make_client(handler)
    try:
        result = await client.call("t1", {"x": 1}, search_id="s1")
    finally:
        await client.close()

    assert result.execution_id == "e1"  # call succeeded despite the broken tracer


@pytest.mark.asyncio
async def test_tracing_disabled_is_a_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    # Simulate opentelemetry not installed: the client must still work unchanged.
    monkeypatch.setattr(observability, "_tracer", None)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"search_id": "s1", "total": 0, "results": []})

    client = make_client(handler)
    try:
        result = await client.discover("weather", limit=3)
    finally:
        await client.close()

    assert result.search_id == "s1"
    assert observability.is_tracing_enabled() is False
