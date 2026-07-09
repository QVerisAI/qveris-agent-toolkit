"""Rate-limit aware retry for the QVeris async client.

Retries responses the QVeris API marks as retryable — ``429 Too Many Requests``
(and ``503``) — honoring the ``Retry-After`` header when present, otherwise
backing off exponentially with full jitter. Retries are bounded by
``max_retries`` and each sleep by ``max_delay`` so a client never hangs.

This drives retries at the *client* level (re-issuing ``client.request(...)``
each attempt) rather than by wrapping the httpx transport, so the client keeps
httpx's environment-proxy / mounts behavior and every attempt sends a fresh,
fully-serialized request body. ``retries`` / ``total_backoff_seconds`` track how
much rate-limit backoff was absorbed, so callers can surface pressure rather
than counting it as failure.
"""

from __future__ import annotations

import asyncio
import email.utils
import random
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

import httpx

DEFAULT_MAX_RETRIES = 3
DEFAULT_BASE_DELAY = 0.5  # seconds; first backoff is ~[0.25, 0.5]s
DEFAULT_MAX_DELAY = 60.0  # seconds; caps any single sleep (incl. Retry-After)
_MAX_BACKOFF_EXPONENT = 30  # guard against 2**attempt overflow at absurd retries

# Responses worth retrying: rate limiting and transient upstream unavailability.
RETRYABLE_STATUS = frozenset({429, 503})


def _parse_http_date(value: Optional[str]) -> Optional[datetime]:
    """Parse an HTTP-date to an aware UTC datetime; ``None`` if unparseable."""
    if not value:
        return None
    try:
        dt = email.utils.parsedate_to_datetime(value)
    except Exception:  # malformed input must never raise out of retry handling
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def parse_retry_after(value: Optional[str], reference_date: Optional[str] = None) -> Optional[float]:
    """Parse a ``Retry-After`` header into seconds.

    Accepts both forms from RFC 9110: a delta in seconds (``"12"``) or an
    HTTP-date. For the HTTP-date form the delay is computed against the
    response's ``Date`` header when given (RFC 9110 §10.2.3), falling back to
    the local clock — keeping the delay accurate under client/server clock
    skew. Returns ``None`` when absent/unparseable, and never a negative
    value. Server-controlled input, so it must never raise.
    """
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    # ``isdigit`` is True for non-ASCII digits (e.g. superscripts) that float()
    # can't parse, so require plain ASCII digits before converting.
    if value.isascii() and value.isdigit():
        return float(value)
    dt = _parse_http_date(value)
    if dt is None:
        return None
    ref = _parse_http_date(reference_date)
    if ref is None:
        ref = datetime.now(timezone.utc)
    return max(0.0, (dt - ref).total_seconds())


class RetryPolicy:
    """Retries rate-limited/transient responses when sending through a client."""

    def __init__(
        self,
        *,
        max_retries: int = DEFAULT_MAX_RETRIES,
        base_delay: float = DEFAULT_BASE_DELAY,
        max_delay: float = DEFAULT_MAX_DELAY,
        sleep: Optional[Callable[[float], Awaitable[None]]] = None,
        rng: Optional[Callable[[], float]] = None,
    ) -> None:
        self.max_retries = max(0, max_retries)
        self.base_delay = base_delay
        self.max_delay = max_delay
        self._sleep = sleep or asyncio.sleep
        self._rng = rng or random.random
        # Observability: how much rate-limit backoff this policy has absorbed.
        self.retries = 0
        self.total_backoff_seconds = 0.0

    async def send(
        self, client: httpx.AsyncClient, method: str, url: str, **kwargs: Any
    ) -> httpx.Response:
        """Send a request through ``client``, retrying 429/503 with backoff."""
        attempt = 0
        while True:
            response = await client.request(method, url, **kwargs)
            if response.status_code not in RETRYABLE_STATUS or attempt >= self.max_retries:
                return response

            # Release the pooled connection before sleeping and re-issuing.
            await response.aread()
            await response.aclose()

            delay = self._delay_for(response, attempt)
            self.retries += 1
            self.total_backoff_seconds += delay
            await self._sleep(delay)
            attempt += 1

    def _delay_for(self, response: httpx.Response, attempt: int) -> float:
        retry_after = parse_retry_after(
            response.headers.get("retry-after"),
            response.headers.get("date"),
        )
        if retry_after is not None:
            return min(retry_after, self.max_delay)
        # Exponential backoff with full jitter, capped at max_delay.
        capped = min(self.base_delay * (2 ** min(attempt, _MAX_BACKOFF_EXPONENT)), self.max_delay)
        return capped * (0.5 + 0.5 * self._rng())
