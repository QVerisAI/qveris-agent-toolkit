from typing import List

import httpx
import pytest

from qveris.client.api import QverisClient
from qveris.client.retry import RetryTransport, parse_retry_after
from qveris.config import QverisConfig


class FakeSleep:
    """Records requested delays instead of actually sleeping."""

    def __init__(self) -> None:
        self.delays: List[float] = []

    async def __call__(self, delay: float) -> None:
        self.delays.append(delay)


def make_transport(handler, sleep=None, rng=None, **kwargs) -> RetryTransport:
    return RetryTransport(
        httpx.MockTransport(handler),
        sleep=sleep or FakeSleep(),
        rng=rng or (lambda: 0.0),
        **kwargs,
    )


async def send(transport: RetryTransport) -> httpx.Response:
    async with httpx.AsyncClient(transport=transport, base_url="https://x.test") as client:
        return await client.get("/")


# --- parse_retry_after -------------------------------------------------------


def test_parse_retry_after_seconds() -> None:
    assert parse_retry_after("12") == 12.0


def test_parse_retry_after_http_date_is_non_negative() -> None:
    # A far-future date yields a positive delay; a past date clamps to 0.
    assert parse_retry_after("Wed, 21 Oct 2099 07:28:00 GMT") > 0
    assert parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT") == 0.0


def test_parse_retry_after_invalid_or_absent() -> None:
    assert parse_retry_after(None) is None
    assert parse_retry_after("") is None
    assert parse_retry_after("not-a-date") is None


# --- RetryTransport ----------------------------------------------------------


@pytest.mark.asyncio
async def test_retries_on_429_then_succeeds_honoring_retry_after() -> None:
    calls: List[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(429, headers={"Retry-After": "2"}, json={"error": "rate"})
        return httpx.Response(200, json={"ok": True})

    sleep = FakeSleep()
    transport = make_transport(handler, sleep=sleep)
    response = await send(transport)

    assert response.status_code == 200
    assert len(calls) == 2
    assert sleep.delays == [2.0]  # honored Retry-After
    assert transport.retries == 1
    assert transport.total_backoff_seconds == 2.0


@pytest.mark.asyncio
async def test_gives_up_after_max_retries_and_returns_final_response() -> None:
    calls: List[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(429, json={"error": "rate"})

    sleep = FakeSleep()
    transport = make_transport(handler, sleep=sleep, max_retries=2)
    response = await send(transport)

    # The final 429 is returned to the caller (not raised); 3 attempts, 2 backoffs.
    assert response.status_code == 429
    assert len(calls) == 3
    assert transport.retries == 2
    assert len(sleep.delays) == 2


@pytest.mark.asyncio
async def test_exponential_backoff_with_jitter_when_no_header() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(429)

    sleep = FakeSleep()
    # rng=1.0 -> jitter factor (0.5 + 0.5*1.0) = 1.0 (full capped delay).
    transport = make_transport(handler, sleep=sleep, max_retries=3, base_delay=1.0, rng=lambda: 1.0)
    await send(transport)

    assert sleep.delays == [1.0, 2.0, 4.0]  # 1*2^0, 1*2^1, 1*2^2


@pytest.mark.asyncio
async def test_backoff_and_retry_after_capped_at_max_delay() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"Retry-After": "9999"})

    sleep = FakeSleep()
    transport = make_transport(handler, sleep=sleep, max_retries=1, max_delay=30.0)
    await send(transport)

    assert sleep.delays == [30.0]  # Retry-After capped at max_delay


@pytest.mark.asyncio
async def test_503_is_retried() -> None:
    calls: List[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(503 if len(calls) == 1 else 200)

    transport = make_transport(handler)
    response = await send(transport)

    assert response.status_code == 200
    assert transport.retries == 1


@pytest.mark.asyncio
async def test_non_retryable_status_is_not_retried() -> None:
    calls: List[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(500, json={"error": "boom"})

    transport = make_transport(handler)
    response = await send(transport)

    assert response.status_code == 500
    assert len(calls) == 1
    assert transport.retries == 0


@pytest.mark.asyncio
async def test_max_retries_zero_disables_retrying() -> None:
    calls: List[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(429)

    transport = make_transport(handler, max_retries=0)
    response = await send(transport)

    assert response.status_code == 429
    assert len(calls) == 1
    assert transport.retries == 0


# --- Client integration ------------------------------------------------------


@pytest.mark.asyncio
async def test_client_discover_retries_and_reports_rate_limit_retries() -> None:
    calls: List[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(429, headers={"Retry-After": "1"}, json={"error": "rate"})
        return httpx.Response(200, json={"search_id": "s1", "total": 0, "results": []})

    client = QverisClient(QverisConfig(api_key="sk-test", base_url="https://qveris.ai/api/v1"))
    transport = make_transport(handler)
    client._retry_transport = transport
    client.client = httpx.AsyncClient(
        base_url=client.base_url, headers=client.headers, transport=transport, timeout=60.0
    )

    try:
        result = await client.discover("weather", limit=3)
    finally:
        await client.close()

    assert result.search_id == "s1"
    assert len(calls) == 2
    assert client.rate_limit_retries == 1
