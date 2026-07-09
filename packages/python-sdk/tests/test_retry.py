import json
from typing import List, Optional

import httpx
import pytest

from qveris.client.api import QverisClient
from qveris.client.retry import RetryPolicy, parse_retry_after
from qveris.config import QverisConfig


class FakeSleep:
    """Records requested delays instead of actually sleeping."""

    def __init__(self) -> None:
        self.delays: List[float] = []

    async def __call__(self, delay: float) -> None:
        self.delays.append(delay)


async def run(handler, *, sleep: Optional[FakeSleep] = None, rng=None, **kwargs):
    """Send a request through a RetryPolicy against a MockTransport handler."""
    policy = RetryPolicy(sleep=sleep or FakeSleep(), rng=rng or (lambda: 0.0), **kwargs)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://x.test") as client:
        response = await policy.send(client, "GET", "/")
    return response, policy


# --- parse_retry_after -------------------------------------------------------


def test_parse_retry_after_seconds() -> None:
    assert parse_retry_after("12") == 12.0


def test_parse_retry_after_http_date_is_non_negative() -> None:
    assert parse_retry_after("Wed, 21 Oct 2099 07:28:00 GMT") > 0
    assert parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT") == 0.0


def test_parse_retry_after_invalid_or_absent_returns_none() -> None:
    assert parse_retry_after(None) is None
    assert parse_retry_after("") is None
    assert parse_retry_after("not-a-date") is None
    assert parse_retry_after("-5") is None
    # isdigit() is True for these but float() can't parse them — must not raise.
    assert parse_retry_after("²") is None  # superscript two
    assert parse_retry_after("⁵") is None  # superscript five


# --- RetryPolicy -------------------------------------------------------------


@pytest.mark.asyncio
async def test_retries_on_429_then_succeeds_honoring_retry_after() -> None:
    calls: List[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(429, headers={"Retry-After": "2"}, json={"error": "rate"})
        return httpx.Response(200, json={"ok": True})

    sleep = FakeSleep()
    response, policy = await run(handler, sleep=sleep)

    assert response.status_code == 200
    assert len(calls) == 2
    assert sleep.delays == [2.0]
    assert policy.retries == 1
    assert policy.total_backoff_seconds == 2.0


@pytest.mark.asyncio
async def test_gives_up_after_max_retries_and_returns_final_response() -> None:
    calls: List[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(429, json={"error": "rate"})

    sleep = FakeSleep()
    response, policy = await run(handler, sleep=sleep, max_retries=2)

    assert response.status_code == 429  # final 429 returned, not raised
    assert len(calls) == 3  # max_retries + 1 attempts
    assert policy.retries == 2
    assert len(sleep.delays) == 2


@pytest.mark.asyncio
async def test_exponential_backoff_with_jitter_when_no_header() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(429)

    sleep = FakeSleep()
    # rng=1.0 -> jitter factor (0.5 + 0.5*1.0) = 1.0 (full capped delay).
    await run(handler, sleep=sleep, max_retries=3, base_delay=1.0, rng=lambda: 1.0)

    assert sleep.delays == [1.0, 2.0, 4.0]


@pytest.mark.asyncio
async def test_retry_after_capped_at_max_delay() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"Retry-After": "9999"})

    sleep = FakeSleep()
    await run(handler, sleep=sleep, max_retries=1, max_delay=30.0)

    assert sleep.delays == [30.0]


def test_delay_never_overflows_at_huge_attempt() -> None:
    policy = RetryPolicy(base_delay=0.5, max_delay=60.0, rng=lambda: 1.0)
    response = httpx.Response(429)  # no Retry-After
    delay = policy._delay_for(response, attempt=5000)  # would overflow 2**attempt
    assert delay == 60.0


@pytest.mark.asyncio
async def test_503_is_retried() -> None:
    calls: List[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(503 if len(calls) == 1 else 200)

    response, policy = await run(handler)
    assert response.status_code == 200
    assert policy.retries == 1


@pytest.mark.asyncio
async def test_non_retryable_status_is_not_retried() -> None:
    calls: List[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(500, json={"error": "boom"})

    response, policy = await run(handler)
    assert response.status_code == 500
    assert len(calls) == 1
    assert policy.retries == 0


@pytest.mark.asyncio
async def test_max_retries_zero_disables_retrying() -> None:
    calls: List[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(429)

    response, policy = await run(handler, max_retries=0)
    assert response.status_code == 429
    assert len(calls) == 1
    assert policy.retries == 0


@pytest.mark.asyncio
async def test_retried_post_resends_the_json_body() -> None:
    bodies: List[bytes] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(request.content)
        if len(bodies) == 1:
            return httpx.Response(429)
        return httpx.Response(200, json={"ok": True})

    policy = RetryPolicy(sleep=FakeSleep(), rng=lambda: 0.0)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://x.test") as client:
        response = await policy.send(client, "POST", "/search", json={"query": "weather"})

    assert response.status_code == 200
    # Both attempts carried the full serialized body (not a consumed/empty stream).
    assert len(bodies) == 2
    assert json.loads(bodies[0]) == {"query": "weather"}
    assert bodies[1] == bodies[0]


# --- Client integration ------------------------------------------------------


@pytest.mark.asyncio
async def test_client_discover_retries_and_reports_rate_limit_retries() -> None:
    calls: List[int] = []

    def handler(_request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(429, headers={"Retry-After": "1"}, json={"error": "rate"})
        return httpx.Response(200, json={"search_id": "s1", "total": 0, "results": []})

    client = QverisClient(QverisConfig(api_key="sk-test", base_url="https://qveris.ai/api/v1"))
    client._retry = RetryPolicy(sleep=FakeSleep(), rng=lambda: 0.0)
    client.client = httpx.AsyncClient(
        base_url=client.base_url,
        headers=client.headers,
        transport=httpx.MockTransport(handler),
        timeout=60.0,
    )

    try:
        result = await client.discover("weather", limit=3)
    finally:
        await client.close()

    assert result.search_id == "s1"
    assert len(calls) == 2
    assert client.rate_limit_retries == 1
