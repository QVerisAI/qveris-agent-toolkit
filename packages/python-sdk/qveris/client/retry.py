"""Rate-limit aware retry transport for the QVeris async client.

Wraps an ``httpx`` transport and transparently retries responses the QVeris API
marks as retryable — ``429 Too Many Requests`` (and ``503``) — honoring the
``Retry-After`` header when present, otherwise backing off exponentially with
full jitter. Retries are bounded by ``max_retries`` and each sleep by
``max_delay`` so a client never hangs indefinitely.

The transport also tracks how often it backed off (``retries`` /
``total_backoff_seconds``) so callers can surface rate-limit pressure as a
statistic rather than a failure.
"""

from __future__ import annotations

import asyncio
import email.utils
import random
from datetime import datetime, timezone
from typing import Awaitable, Callable, Optional

import httpx

DEFAULT_MAX_RETRIES = 3
DEFAULT_BASE_DELAY = 0.5  # seconds; first backoff is ~[0.25, 0.5]s
DEFAULT_MAX_DELAY = 60.0  # seconds; caps any single sleep (incl. Retry-After)

# Responses worth retrying: rate limiting and transient upstream unavailability.
RETRYABLE_STATUS = frozenset({429, 503})


def parse_retry_after(value: Optional[str]) -> Optional[float]:
    """Parse a ``Retry-After`` header into seconds.

    Accepts both forms from RFC 9110: a delta in seconds (``"12"``) or an
    HTTP-date. Returns ``None`` when absent/unparseable, and never a negative
    value.
    """
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if value.isdigit():
        return float(value)
    try:
        dt = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max(0.0, (dt - datetime.now(timezone.utc)).total_seconds())


class RetryTransport(httpx.AsyncBaseTransport):
    """An async transport that retries rate-limited/transient responses."""

    def __init__(
        self,
        transport: httpx.AsyncBaseTransport,
        *,
        max_retries: int = DEFAULT_MAX_RETRIES,
        base_delay: float = DEFAULT_BASE_DELAY,
        max_delay: float = DEFAULT_MAX_DELAY,
        sleep: Optional[Callable[[float], Awaitable[None]]] = None,
        rng: Optional[Callable[[], float]] = None,
    ) -> None:
        self._transport = transport
        self.max_retries = max(0, max_retries)
        self.base_delay = base_delay
        self.max_delay = max_delay
        self._sleep = sleep or asyncio.sleep
        self._rng = rng or random.random
        # Observability: how much rate-limit backoff this transport has absorbed.
        self.retries = 0
        self.total_backoff_seconds = 0.0

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        attempt = 0
        while True:
            response = await self._transport.handle_async_request(request)
            if response.status_code not in RETRYABLE_STATUS or attempt >= self.max_retries:
                return response

            # Release the connection before we sleep and re-send the request.
            await response.aread()
            await response.aclose()

            delay = self._delay_for(response, attempt)
            self.retries += 1
            self.total_backoff_seconds += delay
            await self._sleep(delay)
            attempt += 1

    def _delay_for(self, response: httpx.Response, attempt: int) -> float:
        retry_after = parse_retry_after(response.headers.get("retry-after"))
        if retry_after is not None:
            return min(retry_after, self.max_delay)
        # Exponential backoff with full jitter, capped at max_delay.
        capped = min(self.base_delay * (2 ** attempt), self.max_delay)
        return capped * (0.5 + 0.5 * self._rng())

    async def aclose(self) -> None:
        await self._transport.aclose()
