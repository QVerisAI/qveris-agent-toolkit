"""
Async client for the Qveris API.

`QverisClient` is intentionally small and low-level: it provides direct wrappers around the
Qveris HTTP API plus a helper (`handle_tool_call`) that bridges LLM tool calls to Qveris calls.

Typical usage is indirect via `qveris.Agent`, but you can also use this client to integrate Qveris
into your own agent framework.

## Endpoints

- `POST /search` -> `discover(...)`
- `POST /tools/by-ids` -> `inspect(...)`
- `POST /tools/probe?tool_id=...` -> `probe(...)`
- `POST /tools/execute?tool_id=...` -> `call(...)`
- `GET /auth/usage/history/v2` -> `usage(...)`
- `GET /auth/credits/ledger` -> `ledger(...)`

## Authentication

If `QVERIS_API_KEY` is configured (via `QverisConfig.api_key`), it is sent as:

`Authorization: Bearer <token>`

Debug logs redact the token value.
"""

import asyncio
import json
import re
import time
import warnings
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Literal, Optional, Set, Tuple, Union

import httpx

from ..config import QverisConfig
from ..credentials import (
    ApiKeyCredentialProvider,
    CredentialContext,
    CredentialProvider,
    CredentialResolutionError,
    resolve_credential,
)
from ..errors import (
    QverisApiError,
    QverisClientClosedError,
    QverisContractError,
    QverisCredentialError,
    QverisError,
    QverisTransportError,
    RequestMetadata,
)
from ..observability import (
    ATTR_CREDITS,
    ATTR_ELAPSED_MS,
    ATTR_EXECUTION_ID,
    ATTR_LIMIT,
    ATTR_OPERATION,
    ATTR_RESULT_COUNT,
    ATTR_SEARCH_ID,
    ATTR_SESSION_ID,
    ATTR_SUCCESS,
    ATTR_TOOL_ID,
    ATTR_TOOL_ID_COUNT,
    set_span_attributes,
    start_span,
)
from ..types import (
    CreditsLedgerResponse,
    SearchResponse,
    ToolExecutionResponse,
    ToolProbeResponse,
    UsageHistoryResponse,
)
from .retry import RetryPolicy


_SENSITIVE_KEYS = frozenset(
    {
        "authorization",
        "api_key",
        "apikey",
        "access_token",
        "refresh_token",
        "token",
        "selection_token",
        "full_content_file_url",
        "cookie",
        "set-cookie",
    }
)
_BEARER_PATTERN = re.compile(r"(?i)\bBearer\s+[^\s,;]+")
_API_KEY_PATTERN = re.compile(r"(?i)\bsk-[a-z0-9._-]{8,}")
_SIGNED_URL_MARKERS = (
    "x-amz-signature=",
    "x-goog-signature=",
    "signature=",
    "sig=",
    "token=",
)


@dataclass
class _RequestState:
    operation: str
    started_at: float
    http_attempts: int = 0
    compatibility_replays: int = 0
    request_id: Optional[str] = None


@dataclass(frozen=True)
class _SendFailure:
    error_type: str
    message: str


def _pre_settlement_credits(response: ToolExecutionResponse) -> Optional[float]:
    """Best pre-settlement credit figure from a call response, for a span attribute."""
    if response.billing is not None and response.billing.list_amount_credits is not None:
        return response.billing.list_amount_credits
    return response.cost


def _unsupported_optional_fields(response: httpx.Response, allowed_fields: Set[str]) -> Set[str]:
    """Return optional fields rejected by a legacy service as extra inputs."""
    if response.status_code != 422:
        return set()
    try:
        body = response.json()
    except json.JSONDecodeError:
        return set()
    if not isinstance(body, dict):
        return set()
    candidates = body.get("detail") if isinstance(body.get("detail"), list) else body.get("details")
    if not isinstance(candidates, list):
        return set()
    unsupported: Set[str] = set()
    for item in candidates:
        if not isinstance(item, dict) or item.get("type") != "extra_forbidden":
            continue
        loc = item.get("loc")
        field = loc[-1] if isinstance(loc, list) and loc else None
        if isinstance(field, str) and field in allowed_fields:
            unsupported.add(field)
    return unsupported


class QverisClient:
    """Async client for Qveris API."""

    def __init__(
        self,
        config: Optional[QverisConfig] = None,
        debug_callback: Optional[Callable[[str], None]] = None,
        *,
        credential_provider: Optional[CredentialProvider] = None,
        http_client: Optional[httpx.AsyncClient] = None,
        transport: Optional[httpx.AsyncBaseTransport] = None,
        limits: Optional[httpx.Limits] = None,
    ):
        self.config = config or QverisConfig()
        self.debug_callback = debug_callback
        if credential_provider is not None and self.config.api_key:
            raise ValueError("Configure either api_key or credential_provider, not both")
        if credential_provider is not None:
            if not callable(getattr(credential_provider, "get_credential", None)):
                raise TypeError("credential_provider must implement get_credential")
            self.credential_provider = credential_provider
        elif self.config.api_key:
            self.credential_provider = ApiKeyCredentialProvider(self.config.api_key)
        else:
            raise ValueError("QVeris API key or credential_provider is required")
        self.headers = {
            "Content-Type": "application/json",
        }
        if http_client is not None and (transport is not None or limits is not None):
            raise ValueError("http_client cannot be combined with transport or limits")

        # httpx automatically respects HTTP_PROXY/HTTPS_PROXY env vars (kept by
        # using the default transport). Retries are layered on top at the client
        # level so rate-limited (429) / transient (503) responses back off
        # (Retry-After / jitter) instead of failing the caller.
        self.base_url = self.config.base_url.rstrip("/") + "/"
        self._owns_http_client = http_client is None
        self.client = http_client or httpx.AsyncClient(
            base_url=self.base_url,
            headers=self.headers,
            timeout=self.config.read_timeout,
            transport=transport,
            limits=limits or httpx.Limits(),
        )
        self._retry = RetryPolicy(max_retries=self.config.max_retries)
        self._lifecycle_lock = asyncio.Lock()
        self._close_lock = asyncio.Lock()
        self._no_active_requests = asyncio.Event()
        self._no_active_requests.set()
        self._active_requests = 0
        self._closing = False
        self._closed = False

    async def _begin_request(self, state: _RequestState) -> None:
        async with self._lifecycle_lock:
            if self._closing or self._closed:
                metadata = self._request_metadata(state)
                raise QverisClientClosedError(
                    "QVeris client is closing or closed",
                    operation=state.operation,
                    request_metadata=metadata,
                )
            self._active_requests += 1
            self._no_active_requests.clear()

    async def _ensure_open(self, state: _RequestState) -> None:
        async with self._lifecycle_lock:
            if self._closing or self._closed:
                raise QverisClientClosedError(
                    "QVeris client is closing or closed",
                    operation=state.operation,
                    request_metadata=self._request_metadata(state),
                )

    async def _end_request(self) -> None:
        async with self._lifecycle_lock:
            self._active_requests -= 1
            if self._active_requests == 0:
                self._no_active_requests.set()

    def _request_metadata(self, state: _RequestState) -> RequestMetadata:
        retries = max(0, state.http_attempts - 1 - state.compatibility_replays)
        return RequestMetadata(
            operation=state.operation,
            http_attempts=state.http_attempts,
            retry_attempts=retries,
            compatibility_replays=state.compatibility_replays,
            request_id=state.request_id,
            elapsed_ms=max(0.0, (time.monotonic() - state.started_at) * 1000),
        )

    def _credential_context(
        self,
        operation: str,
        *,
        session_id: Optional[str],
        correlation_id: Optional[str],
    ) -> CredentialContext:
        purpose = {
            "call": "paid_execution",
            "usage": "usage_audit",
            "ledger": "ledger_audit",
        }.get(operation, "data_read")
        return CredentialContext(
            resource=self.config.base_url,
            audience=self.config.credential_audience,
            scopes=self.config.credential_scopes,
            operation=operation,  # type: ignore[arg-type]
            purpose=purpose,  # type: ignore[arg-type]
            session_id=session_id,
            correlation_id=correlation_id,
        )

    @staticmethod
    def _scrub_request_authorization(request: Any) -> None:
        headers = getattr(request, "headers", None)
        if headers is None:
            return
        try:
            if "Authorization" in headers:
                headers["Authorization"] = "Bearer ***"
        except Exception:
            pass

    @staticmethod
    def _scrub_response_credential(response: httpx.Response, credential: Optional[str]) -> None:
        """Remove the attempt credential before a response leaves the transport boundary."""
        if not credential:
            return
        secret = credential.encode()
        try:
            response._content = response.content.replace(secret, b"***")  # type: ignore[attr-defined]
        except Exception:
            pass
        try:
            for key, value in list(response.headers.multi_items()):
                if credential in value:
                    response.headers[key] = value.replace(credential, "***")
        except Exception:
            pass

    def _scrub_error_response(self, response: httpx.Response) -> None:
        """Replace an error body with its bounded, recursively redacted form."""
        if response.status_code < 400:
            return
        try:
            safe_body = self._redact_sensitive(response.json())
        except (json.JSONDecodeError, UnicodeDecodeError):
            safe_body = {"body": "<non-JSON error body omitted>"}
        content = json.dumps(safe_body, ensure_ascii=False).encode()
        response._content = content  # type: ignore[attr-defined]
        response.headers["content-length"] = str(len(content))

    async def _send(
        self,
        method: str,
        endpoint: str,
        *,
        operation: str,
        state: _RequestState,
        session_id: Optional[str] = None,
        correlation_id: Optional[str] = None,
        timeout: Optional[float] = None,
        **kwargs: Any,
    ) -> httpx.Response:
        """Send a request with operation-specific retry and a safe error boundary."""
        request_headers = dict(kwargs.pop("headers", {}))

        def on_attempt() -> None:
            state.http_attempts += 1

        request_timeout = timeout
        if request_timeout is None:
            request_timeout = self.config.call_timeout if operation == "call" else self.config.read_timeout
        retry_limit = 0 if operation == "call" else self.config.max_retries
        url = self.base_url + endpoint.lstrip("/")

        async def perform() -> Union[httpx.Response, _SendFailure]:
            credential: Optional[str] = None

            async def prepare_attempt() -> Dict[str, Any]:
                nonlocal credential
                credential = await resolve_credential(
                    self.credential_provider,
                    self._credential_context(
                        operation,
                        session_id=session_id,
                        correlation_id=correlation_id,
                    ),
                )
                headers = dict(request_headers)
                headers["Authorization"] = f"Bearer {credential}"
                return {"headers": headers}

            try:
                response = await self._retry.send(
                    self.client,
                    method,
                    url,
                    prepare_attempt=prepare_attempt,
                    max_retries=retry_limit,
                    on_attempt=on_attempt,
                    timeout=request_timeout,
                    **kwargs,
                )
                self._scrub_request_authorization(getattr(response, "request", None))
                self._scrub_response_credential(response, credential)
                self._scrub_error_response(response)
                return response
            except asyncio.CancelledError:
                return _SendFailure("cancelled", "QVeris request was cancelled")
            except CredentialResolutionError as exc:
                return _SendFailure("credential", str(exc))
            except httpx.TimeoutException as exc:
                self._scrub_request_authorization(getattr(exc, "request", None))
                return _SendFailure("timeout", "QVeris request timed out")
            except httpx.TransportError as exc:
                self._scrub_request_authorization(getattr(exc, "request", None))
                return _SendFailure(type(exc).__name__.lower(), "QVeris transport request failed")
            except Exception as exc:
                self._scrub_request_authorization(getattr(exc, "request", None))
                return _SendFailure("transport_error", "QVeris transport request failed")

        await self._begin_request(state)
        try:
            outcome = await perform()
        finally:
            await self._end_request()

        if isinstance(outcome, _SendFailure):
            metadata = self._request_metadata(state)
            if outcome.error_type == "cancelled":
                raise asyncio.CancelledError(outcome.message) from None
            if outcome.error_type == "credential":
                raise QverisCredentialError(
                    outcome.message,
                    operation=operation,
                    request_metadata=metadata,
                ) from None
            raise QverisTransportError(
                outcome.message,
                error_type=outcome.error_type,
                operation=operation,
                request_metadata=metadata,
            ) from None

        state.request_id = self._extract_request_id(outcome)
        return outcome

    async def _send_with_optional_field_fallback(
        self,
        method: str,
        endpoint: str,
        payload: Dict[str, Any],
        allowed_fields: Set[str],
        *,
        operation: str,
        state: _RequestState,
        allow_fallback: bool = True,
        **kwargs: Any,
    ) -> httpx.Response:
        """Retry once without optional fields rejected by a legacy service."""
        response = await self._send(
            method,
            endpoint,
            operation=operation,
            state=state,
            json=payload,
            **kwargs,
        )
        unsupported = _unsupported_optional_fields(response, allowed_fields)
        if not unsupported or not allow_fallback:
            return response
        state.compatibility_replays += 1
        fallback_payload = {key: value for key, value in payload.items() if key not in unsupported}
        return await self._send(
            method,
            endpoint,
            operation=operation,
            state=state,
            json=fallback_payload,
            **kwargs,
        )

    @property
    def rate_limit_retries(self) -> int:
        """How many times the client has backed off on a 429/503 so far.

        Rate-limit backoff is retried pressure, not failure — surface this
        rather than counting the retried responses as errors.
        """
        retry = getattr(self, "_retry", None)
        return retry.retries if retry is not None else 0

    def _debug(self, message: str):
        """Print debug message if callback is set."""
        if self.debug_callback:
            self.debug_callback(message)

    def _redact_sensitive(self, value: Any, depth: int = 0) -> Any:
        """Recursively redact credential-bearing and signed-URL fields."""
        if depth >= 8:
            return "<diagnostic value omitted>"
        if isinstance(value, dict):
            safe: Dict[Any, Any] = {}
            for index, (key, item) in enumerate(value.items()):
                if index >= 100:
                    safe["__truncated__"] = True
                    break
                safe[key] = "***" if str(key).lower() in _SENSITIVE_KEYS else self._redact_sensitive(item, depth + 1)
            return safe
        if isinstance(value, list):
            return [self._redact_sensitive(item, depth + 1) for item in value[:100]]
        if isinstance(value, tuple):
            return tuple(self._redact_sensitive(item, depth + 1) for item in value[:100])
        if isinstance(value, str):
            safe = _BEARER_PATTERN.sub("Bearer ***", value)
            safe = _API_KEY_PATTERN.sub("***", safe)
            lower = safe.lower()
            if safe.startswith(("http://", "https://")) and any(marker in lower for marker in _SIGNED_URL_MARKERS):
                return "***"
            if len(safe) > 8192:
                return safe[:8192] + "..."
            return safe
        return value

    def _safe_message(self, value: Any, fallback: str) -> str:
        safe = self._redact_sensitive(value)
        if not isinstance(safe, str) or not safe.strip():
            return fallback
        return safe[:2048]

    def _parse_response_json(self, response: httpx.Response) -> Any:
        """Parse response JSON once while still logging non-JSON bodies for debugging."""
        try:
            data = response.json()
            safe_data = self._redact_sensitive(data)
            self._debug(f"[Qveris API] Response body: {json.dumps(safe_data, indent=2)}")
            return data
        except json.JSONDecodeError:
            self._debug("[Qveris API] Response body: <non-JSON body omitted>")
            raise

    def _url_for(self, method: str, path: str, params: Optional[Dict[str, Any]] = None) -> str:
        """Build the effective request URL using the same httpx client settings."""
        return str(httpx.Request(method, self.base_url + path.lstrip("/"), params=params).url)

    def _debug_headers(self) -> None:
        """Log request headers with authorization redacted."""
        headers = dict(self.headers)
        if self.credential_provider is not None:
            headers["Authorization"] = "Bearer ***"
        self._debug(f"[Qveris API] Headers: {json.dumps(headers, indent=2)}")

    def _query_params(self, **kwargs: Any) -> Dict[str, Any]:
        """Drop None-valued query params while preserving falsey filters like 0 and False."""
        return {key: value for key, value in kwargs.items() if value is not None}

    @staticmethod
    def _extract_request_id(response: httpx.Response) -> Optional[str]:
        return (
            response.headers.get("x-request-id")
            or response.headers.get("x-qveris-request-id")
            or response.headers.get("x-correlation-id")
        )

    def _api_error_from_response(
        self,
        response: httpx.Response,
        *,
        operation: str,
        state: _RequestState,
    ) -> Optional[QverisApiError]:
        if response.status_code < 400:
            return None
        try:
            raw_details = response.json()
        except json.JSONDecodeError:
            raw_details = {"body": "<non-JSON error body omitted>"}
        details = self._redact_sensitive(raw_details)
        message = response.reason_phrase or f"HTTP {response.status_code}"
        code = None
        category = None
        if isinstance(details, dict):
            message = self._safe_message(
                details.get("error_message") or details.get("message") or details.get("error") or message,
                f"HTTP {response.status_code}",
            )
            code_value = details.get("code") or details.get("error_code") or details.get("reason_code")
            category_value = details.get("category") or details.get("error_category")
            code = str(code_value) if code_value is not None else None
            category = str(category_value) if category_value is not None else None
        return QverisApiError(
            message,
            status=response.status_code,
            operation=operation,
            request_metadata=self._request_metadata(state),
            code=code,
            category=category,
            details=details,
        )

    def _unwrap_envelope(self, data: Any, *, operation: str, state: _RequestState) -> Any:
        """Accept both raw payloads and standard {status, data} API envelopes."""
        if (
            isinstance(data, dict)
            and "data" in data
            and ("status" in data or "status_code" in data or "message" in data)
        ):
            status = data.get("status") or data.get("status_code")
            if self._is_failure_status(status):
                raise QverisContractError(
                    self._safe_message(data.get("message"), "API returned failure status"),
                    operation=operation,
                    request_metadata=self._request_metadata(state),
                )
            return data["data"]
        return data

    def _is_failure_status(self, status: Any) -> bool:
        """Return whether an API envelope status represents failure."""
        if isinstance(status, str):
            return status.lower() in {"failure", "failed", "error"}
        if isinstance(status, int):
            return status >= 400
        return False

    async def close(self):
        """
        Close the underlying HTTP client.

        Call this if you create `QverisClient` directly and want to free network resources.
        """
        async with self._close_lock:
            async with self._lifecycle_lock:
                if self._closed:
                    return
                self._closing = True
            try:
                await self._no_active_requests.wait()
                if self._owns_http_client:
                    await self.client.aclose()
            except asyncio.CancelledError:
                async with self._lifecycle_lock:
                    self._closing = False
                raise
            async with self._lifecycle_lock:
                self._closed = True

    async def discover(
        self,
        query: str,
        limit: int = 20,
        session_id: Optional[str] = None,
        view: Optional[Literal["routing", "full"]] = None,
        lang: Optional[Literal["zh", "en"]] = None,
        timeout: Optional[float] = None,
        correlation_id: Optional[str] = None,
    ) -> SearchResponse:
        """
        Discover capabilities using natural language.

        Args:
            query: Natural-language description of the capability you want (not parameters).
                   Example: "weather forecast API" or "search recent news".
            limit: Maximum number of tools to return (server may cap this).
            session_id: Optional correlation id.
            view: Optional response projection. Omit for the legacy/full response.
            lang: Optional response language; omit for server-side negotiation.

        Returns:
            `SearchResponse` containing `results` (tools) and `search_id` used for execution.
        """
        url = self._url_for("POST", "search")
        payload = {
            "query": query,
            "limit": limit,
        }

        if session_id:
            payload["session_id"] = session_id
        if view is not None:
            payload["view"] = view
        if lang is not None:
            payload["lang"] = lang

        state = _RequestState("discover", time.monotonic())
        with start_span(
            "qveris.discover",
            {ATTR_OPERATION: "discover", ATTR_LIMIT: limit, ATTR_SESSION_ID: session_id},
        ) as span:
            self._debug(f"[Qveris API] POST {url}")
            self._debug(f"[Qveris API] Request body: {json.dumps(self._redact_sensitive(payload), indent=2)}")
            self._debug_headers()

            response = await self._send_with_optional_field_fallback(
                "POST",
                "search",
                payload,
                {"view", "lang"},
                operation="discover",
                state=state,
                session_id=session_id,
                correlation_id=correlation_id,
                timeout=timeout,
            )

            self._debug(f"[Qveris API] Response status: {response.status_code}")
            error = self._api_error_from_response(response, operation="discover", state=state)
            if error is not None:
                raise error from None
            data = self._unwrap_envelope(self._parse_response_json(response), operation="discover", state=state)
            result = SearchResponse(**data)
            result._set_request_metadata(self._request_metadata(state))
            set_span_attributes(
                span,
                {
                    ATTR_SEARCH_ID: result.search_id,
                    ATTR_RESULT_COUNT: result.total if result.total is not None else len(result.results or []),
                    ATTR_ELAPSED_MS: result.elapsed_time_ms,
                },
            )
            return result

    async def search_tools(self, query: str, limit: int = 20, session_id: Optional[str] = None) -> SearchResponse:
        """Deprecated alias for `discover(...)`."""
        return await self.discover(query=query, limit=limit, session_id=session_id)

    async def inspect(
        self,
        tool_ids: Union[Iterable[str], str],
        search_id: Optional[str] = None,
        session_id: Optional[str] = None,
        timeout: Optional[float] = None,
        correlation_id: Optional[str] = None,
    ) -> SearchResponse:
        """
        Inspect one or more capabilities by tool ID.

        Args:
            tool_ids: Tool IDs returned by `discover(...)`. A single string is accepted.
            search_id: Optional search ID that produced the tools.
            session_id: Optional correlation ID.

        Returns:
            `SearchResponse` with full tool details for the requested IDs.
        """
        ids = [tool_ids] if isinstance(tool_ids, str) else list(tool_ids or [])
        state = _RequestState("inspect", time.monotonic())
        if not ids:
            await self._ensure_open(state)
            result = SearchResponse(search_id=search_id, total=0, results=[])
            result._set_request_metadata(self._request_metadata(state))
            return result

        url = self._url_for("POST", "tools/by-ids")
        payload: Dict[str, Any] = {"tool_ids": ids}
        if search_id:
            payload["search_id"] = search_id
        if session_id:
            payload["session_id"] = session_id

        with start_span(
            "qveris.inspect",
            {
                ATTR_OPERATION: "inspect",
                ATTR_TOOL_ID_COUNT: len(ids),
                ATTR_SEARCH_ID: search_id,
                ATTR_SESSION_ID: session_id,
            },
        ) as span:
            self._debug(f"[Qveris API] POST {url}")
            self._debug(f"[Qveris API] Request body: {json.dumps(self._redact_sensitive(payload), indent=2)}")
            self._debug_headers()

            response = await self._send(
                "POST",
                "tools/by-ids",
                operation="inspect",
                state=state,
                session_id=session_id,
                correlation_id=correlation_id,
                timeout=timeout,
                json=payload,
            )

            self._debug(f"[Qveris API] Response status: {response.status_code}")
            error = self._api_error_from_response(response, operation="inspect", state=state)
            if error is not None:
                raise error from None
            data = self._unwrap_envelope(self._parse_response_json(response), operation="inspect", state=state)
            result = SearchResponse(**data)
            result._set_request_metadata(self._request_metadata(state))
            set_span_attributes(span, {ATTR_RESULT_COUNT: len(result.results or [])})
            return result

    async def get_tools_by_ids(
        self,
        tool_ids: Union[Iterable[str], str],
        search_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> SearchResponse:
        """Deprecated alias for `inspect(...)`."""
        return await self.inspect(tool_ids=tool_ids, search_id=search_id, session_id=session_id)

    async def probe(
        self,
        tool_id: str,
        parameters: Optional[Dict[str, Any]] = None,
        checks: Optional[List[Literal["schema", "quote", "coverage", "sample"]]] = None,
        live_budget: Literal["none", "metadata", "sampled"] = "none",
        timeout: Optional[float] = None,
        correlation_id: Optional[str] = None,
    ) -> ToolProbeResponse:
        """Validate candidate parameters and obtain a zero-cost quote without execution."""
        url = self._url_for("POST", "tools/probe", params={"tool_id": tool_id})
        payload: Dict[str, Any] = {
            "parameters": parameters if parameters is not None else {},
            "checks": checks if checks is not None else ["schema"],
            "live_budget": live_budget,
        }
        state = _RequestState("probe", time.monotonic())
        with start_span("qveris.probe", {ATTR_OPERATION: "probe", ATTR_TOOL_ID: tool_id}) as span:
            self._debug(f"[Qveris API] POST {url}")
            self._debug(f"[Qveris API] Request body: {json.dumps(self._redact_sensitive(payload), indent=2)}")
            self._debug_headers()
            response = await self._send(
                "POST",
                "tools/probe",
                operation="probe",
                state=state,
                correlation_id=correlation_id,
                timeout=timeout,
                json=payload,
                params={"tool_id": tool_id},
            )
            self._debug(f"[Qveris API] Response status: {response.status_code}")
            error = self._api_error_from_response(response, operation="probe", state=state)
            if error is not None:
                raise error from None
            data = self._unwrap_envelope(self._parse_response_json(response), operation="probe", state=state)
            result = ToolProbeResponse(**data)
            result._set_request_metadata(self._request_metadata(state))
            set_span_attributes(span, {ATTR_SUCCESS: result.schema_ is None or result.schema_.valid})
            return result

    async def call(
        self,
        tool_id: str,
        parameters: Dict[str, Any],
        search_id: Optional[str] = None,
        session_id: Optional[str] = None,
        max_response_size: Optional[int] = None,
        respond_with: Optional[str] = None,
        compatibility_mode: Literal["strict", "legacy_optional_fields"] = "strict",
        timeout: Optional[float] = None,
        correlation_id: Optional[str] = None,
    ) -> ToolExecutionResponse:
        """
        Call a specific capability.

        Args:
            tool_id: Tool identifier returned by `discover(...)`.
            parameters: JSON-serializable parameters for the tool.
            search_id: Search ID returned by `discover(...)` (recommended for traceability).
            session_id: Optional correlation id.
            max_response_size: Optional max response size in bytes. Large responses may be truncated.
            respond_with: Optional server-side projection (`full`, `summary`, or `fields:<JSONPath,...>`).
            compatibility_mode: Strict mode never resubmits a paid call. The deprecated
                legacy mode may replay once without an unsupported optional field.
            timeout: HTTP request timeout in seconds; credential acquisition is separate.
            correlation_id: Non-sensitive reference forwarded only to the credential provider.

        Returns:
            `ToolExecutionResponse` with `success`, `result`, and metadata.
        """
        url = self._url_for("POST", "tools/execute", params={"tool_id": tool_id})
        payload: Dict[str, Any] = {
            "parameters": parameters,
        }

        if search_id:
            payload["search_id"] = search_id

        if session_id:
            payload["session_id"] = session_id

        if max_response_size is not None:
            payload["max_response_size"] = max_response_size

        if respond_with is not None:
            payload["respond_with"] = respond_with

        if compatibility_mode not in {"strict", "legacy_optional_fields"}:
            raise ValueError("compatibility_mode must be 'strict' or 'legacy_optional_fields'")
        if compatibility_mode == "legacy_optional_fields":
            warnings.warn(
                "legacy_optional_fields may resubmit a paid call; prefer strict mode",
                DeprecationWarning,
                stacklevel=2,
            )

        state = _RequestState("call", time.monotonic())
        with start_span(
            "qveris.call",
            {
                ATTR_OPERATION: "call",
                ATTR_TOOL_ID: tool_id,
                ATTR_SEARCH_ID: search_id,
                ATTR_SESSION_ID: session_id,
            },
        ) as span:
            self._debug(f"[Qveris API] POST {url}")
            self._debug(f"[Qveris API] Request body: {json.dumps(self._redact_sensitive(payload), indent=2)}")
            self._debug_headers()

            response = await self._send_with_optional_field_fallback(
                "POST",
                "tools/execute",
                payload,
                {"respond_with"},
                operation="call",
                state=state,
                allow_fallback=compatibility_mode == "legacy_optional_fields",
                session_id=session_id,
                correlation_id=correlation_id,
                timeout=timeout,
                params={"tool_id": tool_id},
            )

            self._debug(f"[Qveris API] Response status: {response.status_code}")
            error = self._api_error_from_response(response, operation="call", state=state)
            if error is not None:
                raise error from None
            data = self._unwrap_envelope(self._parse_response_json(response), operation="call", state=state)
            result = ToolExecutionResponse(**data)
            result._set_request_metadata(self._request_metadata(state))
            set_span_attributes(
                span,
                {
                    ATTR_EXECUTION_ID: result.execution_id,
                    ATTR_SUCCESS: result.success,
                    ATTR_ELAPSED_MS: result.elapsed_time_ms,
                    ATTR_CREDITS: _pre_settlement_credits(result),
                },
            )
            return result

    async def execute_tool(
        self,
        tool_id: str,
        parameters: Dict[str, Any],
        search_id: Optional[str] = None,
        session_id: Optional[str] = None,
        max_response_size: Optional[int] = None,
    ) -> ToolExecutionResponse:
        """Deprecated alias for `call(...)`."""
        return await self.call(
            tool_id=tool_id,
            parameters=parameters,
            search_id=search_id,
            session_id=session_id,
            max_response_size=max_response_size,
        )

    async def usage(
        self,
        *,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        summary: Optional[bool] = True,
        bucket: Optional[str] = None,
        event_type: Optional[str] = None,
        kind: Optional[str] = None,
        success: Optional[bool] = None,
        charge_outcome: Optional[str] = None,
        search_id: Optional[str] = None,
        execution_id: Optional[str] = None,
        min_credits: Optional[float] = None,
        max_credits: Optional[float] = None,
        limit: Optional[int] = None,
        page: Optional[int] = None,
        page_size: Optional[int] = None,
        timeout: Optional[float] = None,
        correlation_id: Optional[str] = None,
    ) -> UsageHistoryResponse:
        """
        Query request-level usage audit history.

        Use this to verify success, failure, charge outcome, and final settlement
        context for discover/inspect/call activity.
        """
        params = self._query_params(
            start_date=start_date,
            end_date=end_date,
            summary=summary,
            bucket=bucket,
            event_type=event_type,
            kind=kind,
            success=success,
            charge_outcome=charge_outcome,
            search_id=search_id,
            execution_id=execution_id,
            min_credits=min_credits,
            max_credits=max_credits,
            limit=limit,
            page=page,
            page_size=page_size,
        )

        self._debug(f"[Qveris API] GET {self._url_for('GET', 'auth/usage/history/v2', params=params)}")
        self._debug_headers()
        state = _RequestState("usage", time.monotonic())
        response = await self._send(
            "GET",
            "auth/usage/history/v2",
            operation="usage",
            state=state,
            correlation_id=correlation_id,
            timeout=timeout,
            params=params,
        )
        self._debug(f"[Qveris API] Response status: {response.status_code}")
        error = self._api_error_from_response(response, operation="usage", state=state)
        if error is not None:
            raise error from None
        data = self._unwrap_envelope(self._parse_response_json(response), operation="usage", state=state)
        result = UsageHistoryResponse(**data)
        result._set_request_metadata(self._request_metadata(state))
        return result

    async def ledger(
        self,
        *,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        summary: Optional[bool] = True,
        bucket: Optional[str] = None,
        entry_type: Optional[str] = None,
        direction: Optional[str] = None,
        min_credits: Optional[float] = None,
        max_credits: Optional[float] = None,
        limit: Optional[int] = None,
        page: Optional[int] = None,
        page_size: Optional[int] = None,
        timeout: Optional[float] = None,
        correlation_id: Optional[str] = None,
    ) -> CreditsLedgerResponse:
        """
        Query final credits ledger entries.

        Use this when you need authoritative credit balance movements rather than
        pre-settlement billing hints returned by `call(...)`.
        """
        params = self._query_params(
            start_date=start_date,
            end_date=end_date,
            summary=summary,
            bucket=bucket,
            entry_type=entry_type,
            direction=direction,
            min_credits=min_credits,
            max_credits=max_credits,
            limit=limit,
            page=page,
            page_size=page_size,
        )

        self._debug(f"[Qveris API] GET {self._url_for('GET', 'auth/credits/ledger', params=params)}")
        self._debug_headers()
        state = _RequestState("ledger", time.monotonic())
        response = await self._send(
            "GET",
            "auth/credits/ledger",
            operation="ledger",
            state=state,
            correlation_id=correlation_id,
            timeout=timeout,
            params=params,
        )
        self._debug(f"[Qveris API] Response status: {response.status_code}")
        error = self._api_error_from_response(response, operation="ledger", state=state)
        if error is not None:
            raise error from None
        data = self._unwrap_envelope(self._parse_response_json(response), operation="ledger", state=state)
        result = CreditsLedgerResponse(**data)
        result._set_request_metadata(self._request_metadata(state))
        return result

    async def handle_tool_call(
        self,
        func_name: str,
        func_args: Dict[str, Any],
        session_id: Optional[str] = None,
    ) -> Tuple[Any, bool, bool]:
        """
        Handle a built-in Qveris tool call from an LLM response.

        Args:
            func_name: The name of the function/tool to call
            func_args: The arguments parsed from the LLM response
            session_id: Optional session ID for tracking

        Returns:
            Tuple of (result, is_error, handled) where:
            - result: the tool output (None if not handled)
            - is_error: True if an error occurred
            - handled: True if this was a Qveris tool and was processed

        Notes:
            - `params_to_tool` may be either a dict (canonical) or a JSON string (legacy).
            - If `func_name` is not a Qveris built-in, `(None, False, False)` is returned so that
              callers can route to their own tool handlers.
        """
        try:
            if func_name in {"discover", "search_tools"}:
                result = await self.discover(
                    query=func_args.get("query"),
                    limit=func_args.get("limit", 20),
                    session_id=session_id,
                )
                return result.model_dump(), False, True

            if func_name in {"inspect", "get_tools_by_ids"}:
                result = await self.inspect(
                    tool_ids=func_args.get("tool_ids") or [],
                    search_id=func_args.get("search_id"),
                    session_id=session_id,
                )
                return result.model_dump(), False, True

            if func_name in {"call", "execute_tool"}:
                params_val = func_args.get("params_to_tool")
                if isinstance(params_val, str):
                    try:
                        params = json.loads(params_val) if params_val else {}
                    except json.JSONDecodeError as e:
                        return {"error": f"Invalid JSON in params_to_tool: {e}"}, True, True
                else:
                    params = params_val if isinstance(params_val, dict) else {}

                result = await self.call(
                    tool_id=func_args.get("tool_id"),
                    parameters=params,
                    search_id=func_args.get("search_id"),
                    session_id=session_id,
                    max_response_size=func_args.get("max_response_size"),
                )
                return result.model_dump(), False, True

            # Not a Qveris tool.
            return None, False, False

        except QverisApiError as error:
            return (
                {
                    "error": str(error),
                    "status": error.status,
                    "code": error.code,
                    "operation": error.operation,
                    "http_attempts": error.request_metadata.http_attempts,
                },
                True,
                True,
            )
        except QverisError as error:
            return (
                {
                    "error": str(error),
                    "operation": error.operation,
                    "http_attempts": error.request_metadata.http_attempts,
                },
                True,
                True,
            )
        except Exception:
            return {"error": "Unexpected QVeris client error"}, True, True
