"""Credential providers for authenticated QVeris API requests."""

from __future__ import annotations

import asyncio
import base64
import json
import math
import time
from dataclasses import dataclass
from typing import Any, FrozenSet, Literal, Mapping, Optional, Protocol, Sequence, Tuple
from urllib.parse import quote_plus, urlencode, urlsplit

import httpx


CredentialOperation = Literal[
    "discover",
    "inspect",
    "probe",
    "call",
    "credits",
    "usage",
    "ledger",
]
CredentialPurpose = Literal["data_read", "paid_execution", "usage_audit", "ledger_audit"]


class CredentialResolutionError(Exception):
    """Internal credential failure marker that never includes credential data."""


@dataclass(frozen=True)
class _CredentialResult:
    value: Optional[str] = None
    error: Optional[str] = None
    delegation_code: Optional[str] = None
    status: Optional[int] = None


@dataclass(frozen=True)
class CredentialContext:
    """Context supplied whenever the client requests a credential."""

    resource: str
    audience: Optional[str] = None
    scopes: Tuple[str, ...] = ()
    operation: CredentialOperation = "discover"
    purpose: CredentialPurpose = "data_read"
    session_id: Optional[str] = None
    correlation_id: Optional[str] = None


class CredentialProvider(Protocol):
    """Async source of bearer credentials for QVeris API requests."""

    async def get_credential(self, context: CredentialContext) -> str:
        """Return a bearer credential for ``context``."""
        ...


class ApiKeyCredentialProvider:
    """Credential provider backed by a static QVeris API key."""

    def __init__(self, api_key: str) -> None:
        value = api_key.strip()
        if not value or "\r" in value or "\n" in value:
            raise ValueError("QVeris API key is required")
        self._api_key = value

    async def get_credential(self, context: CredentialContext) -> str:
        return self._api_key


@dataclass(frozen=True)
class AgentDelegationConstraints:
    """Optional restrictions embedded in an Agent delegation token."""

    model: Optional[str] = None
    tool_ids: Tuple[str, ...] = ()
    provider_ids: Tuple[str, ...] = ()
    run_id: Optional[str] = None
    max_credits: Optional[int] = None


class AgentDelegationError(CredentialResolutionError):
    """Credential-safe Agent token exchange failure."""

    def __init__(self, code: str, message: str, *, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class _DelegationToken:
    access_token: str
    expires_at: float
    scopes: FrozenSet[str]


class AgentDelegationCredentialProvider:
    """Exchange a user OAuth token for a short-lived in-memory Agent token.

    The provider implements RFC 8693 against the explicitly configured QVeris
    token endpoint. It never writes delegation tokens to disk, never refreshes
    them, and rejects request contexts that exceed the configured resource or
    scope ceiling.
    """

    _TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange"
    _ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"
    _MAX_RESPONSE_BYTES = 64 * 1024

    def __init__(
        self,
        *,
        token_endpoint: str,
        client_id: str,
        client_secret: str,
        subject_credential_provider: CredentialProvider,
        resource: str,
        scopes: Sequence[str],
        constraints: Optional[AgentDelegationConstraints] = None,
        http_client: Optional[httpx.AsyncClient] = None,
        exchange_timeout: float = 30.0,
        expiry_skew_seconds: float = 30.0,
    ) -> None:
        self._token_endpoint = _validate_http_url(token_endpoint, "token_endpoint", require_secure=True)
        self._client_id = _validate_secret(client_id, "client_id")
        self._client_secret = _validate_secret(client_secret, "client_secret")
        if not callable(getattr(subject_credential_provider, "get_credential", None)):
            raise AgentDelegationError(
                "invalid_configuration",
                "subject_credential_provider must implement get_credential",
            )
        self._subject_credential_provider = subject_credential_provider
        self._resource = _validate_http_url(resource, "resource")
        self._scopes = _normalize_scopes(scopes)
        self._scope_set = frozenset(self._scopes)
        self._constraints = _validate_constraints(constraints or AgentDelegationConstraints())
        self._http_client = http_client
        if not math.isfinite(exchange_timeout) or exchange_timeout <= 0:
            raise AgentDelegationError("invalid_configuration", "exchange_timeout must be positive")
        self._exchange_timeout = exchange_timeout
        if not math.isfinite(expiry_skew_seconds) or expiry_skew_seconds < 0 or expiry_skew_seconds >= 600:
            raise AgentDelegationError(
                "invalid_configuration",
                "expiry_skew_seconds must be between 0 and 599",
            )
        self._expiry_skew_seconds = expiry_skew_seconds
        self._lock = asyncio.Lock()
        self._cached: Optional[_DelegationToken] = None

    async def get_credential(self, context: CredentialContext) -> str:
        required_scopes = self._validate_context(context)
        token = self._cached
        if token is not None and token.expires_at > time.monotonic() and required_scopes.issubset(token.scopes):
            return token.access_token

        async with self._lock:
            token = self._cached
            if token is not None and token.expires_at > time.monotonic() and required_scopes.issubset(token.scopes):
                return token.access_token
            token = await self._exchange_token(context)
            if not required_scopes.issubset(token.scopes):
                raise AgentDelegationError(
                    "invalid_token_response",
                    "Delegation token does not cover the requested scopes",
                )
            self._cached = token
            return token.access_token

    def clear(self) -> None:
        """Drop the cached in-memory token without persisting or revoking it."""

        self._cached = None

    def _validate_context(self, context: CredentialContext) -> FrozenSet[str]:
        if context.audience != self._resource:
            raise AgentDelegationError(
                "context_mismatch",
                "Credential context audience does not match the delegated resource",
            )
        requested = frozenset(_normalize_scopes(context.scopes))
        if not requested.issubset(self._scope_set):
            raise AgentDelegationError(
                "context_mismatch",
                "Credential context requests scopes outside the delegation ceiling",
            )
        return requested

    async def _exchange_token(self, context: CredentialContext) -> _DelegationToken:
        try:
            subject_token = await resolve_credential(self._subject_credential_provider, context)
        except Exception:
            raise AgentDelegationError(
                "subject_credential_failed",
                "The subject credential provider failed to provide a user access token",
            ) from None

        form: list[tuple[str, str]] = [
            ("grant_type", self._TOKEN_EXCHANGE_GRANT),
            ("subject_token", subject_token),
            ("subject_token_type", self._ACCESS_TOKEN_TYPE),
            ("requested_token_type", self._ACCESS_TOKEN_TYPE),
            ("resource", self._resource),
            ("scope", " ".join(self._scopes)),
        ]
        _append_constraints(form, self._constraints)
        basic_value = f"{quote_plus(self._client_id)}:{quote_plus(self._client_secret)}"
        basic = base64.b64encode(basic_value.encode()).decode("ascii")
        headers = {
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        encoded_form = urlencode(form)

        try:
            if self._http_client is None:
                async with httpx.AsyncClient(timeout=self._exchange_timeout, follow_redirects=False) as client:
                    response = await client.post(self._token_endpoint, content=encoded_form, headers=headers)
            else:
                response = await self._http_client.post(
                    self._token_endpoint,
                    content=encoded_form,
                    headers=headers,
                    timeout=self._exchange_timeout,
                    follow_redirects=False,
                )
        except Exception:
            raise AgentDelegationError(
                "token_exchange_failed",
                "Agent token exchange failed before a response was received",
            ) from None

        if len(response.content) > self._MAX_RESPONSE_BYTES:
            raise AgentDelegationError(
                "invalid_token_response",
                "Agent token response exceeded the size limit",
            )
        if not response.is_success:
            raise AgentDelegationError(
                "token_exchange_failed",
                "Agent token exchange was rejected",
                status=response.status_code,
            )
        try:
            payload = json.loads(response.content)
        except Exception:
            raise AgentDelegationError(
                "invalid_token_response",
                "Agent token response was not valid JSON",
            ) from None
        return self._validate_token_response(payload)

    def _validate_token_response(self, value: Any) -> _DelegationToken:
        if not isinstance(value, dict):
            raise AgentDelegationError("invalid_token_response", "Agent token response had an invalid shape")
        if "refresh_token" in value:
            raise AgentDelegationError(
                "invalid_token_response",
                "Delegation tokens must not include a refresh token",
            )
        access_token = _validate_returned_token(value.get("access_token"))
        if value.get("token_type") != "Bearer" or value.get("issued_token_type") != self._ACCESS_TOKEN_TYPE:
            raise AgentDelegationError(
                "invalid_token_response",
                "Agent token response declared an unsupported token type",
            )
        expires_in = value.get("expires_in")
        if not isinstance(expires_in, int) or isinstance(expires_in, bool) or expires_in <= 0 or expires_in > 600:
            raise AgentDelegationError(
                "invalid_token_response",
                "Agent token response declared an invalid lifetime",
            )
        if value.get("resource") != self._resource or not isinstance(value.get("scope"), str):
            raise AgentDelegationError(
                "invalid_token_response",
                "Agent token response changed the delegated resource or scope",
            )
        response_scopes = frozenset(_normalize_scopes(value["scope"].split()))
        if not response_scopes.issubset(self._scope_set):
            raise AgentDelegationError(
                "invalid_token_response",
                "Agent token response widened the requested scopes",
            )
        _validate_returned_constraints(value.get("constraints"), self._constraints)
        skew = min(self._expiry_skew_seconds, expires_in / 2)
        return _DelegationToken(
            access_token=access_token,
            expires_at=time.monotonic() + expires_in - skew,
            scopes=response_scopes,
        )


async def resolve_credential(provider: CredentialProvider, context: CredentialContext) -> str:
    """Resolve a valid credential without including its value in errors."""

    async def attempt() -> _CredentialResult:
        try:
            value = await provider.get_credential(context)
        except AgentDelegationError as error:
            return _CredentialResult(
                error="agent_delegation",
                delegation_code=error.code,
                status=error.status,
            )
        except Exception:
            return _CredentialResult(error="provider_failed")
        if not isinstance(value, str) or not value.strip() or "\r" in value or "\n" in value:
            return _CredentialResult(error="invalid_credential")
        return _CredentialResult(value=value.strip())

    result = await attempt()
    if result.error == "agent_delegation" and result.delegation_code is not None:
        raise AgentDelegationError(
            result.delegation_code,
            _delegation_error_message(result.delegation_code),
            status=result.status,
        ) from None
    if result.error == "provider_failed":
        raise CredentialResolutionError("QVeris credential provider failed to provide a credential") from None
    if result.error == "invalid_credential" or result.value is None:
        raise CredentialResolutionError("QVeris credential provider returned an invalid credential") from None
    return result.value


def _delegation_error_message(code: str) -> str:
    return {
        "invalid_configuration": "Agent delegation provider configuration is invalid",
        "context_mismatch": "Agent delegation credential context is not authorized",
        "subject_credential_failed": "The subject credential could not be resolved",
        "token_exchange_failed": "Agent token exchange failed",
        "invalid_token_response": "Agent token exchange returned an invalid response",
    }.get(code, "Agent delegation credential resolution failed")


def _validate_http_url(value: str, label: str, *, require_secure: bool = False) -> str:
    if not isinstance(value, str) or not value.strip() or "\r" in value or "\n" in value:
        raise AgentDelegationError("invalid_configuration", f"{label} must be a valid HTTP(S) URL")
    candidate = value.strip()
    parsed = urlsplit(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise AgentDelegationError("invalid_configuration", f"{label} must be a valid HTTP(S) URL")
    if require_secure and parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise AgentDelegationError("invalid_configuration", f"{label} must use HTTPS or a loopback host")
    if parsed.query or parsed.fragment:
        raise AgentDelegationError("invalid_configuration", f"{label} must be a valid HTTP(S) URL")
    return candidate.rstrip("/")


def _validate_secret(value: str, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or "\r" in value or "\n" in value:
        raise AgentDelegationError("invalid_configuration", f"{label} is invalid")
    return value


def _validate_returned_token(value: Any) -> str:
    if not isinstance(value, str) or not value.strip() or "\r" in value or "\n" in value:
        raise AgentDelegationError(
            "invalid_token_response",
            "Agent token response did not contain a valid access token",
        )
    return value.strip()


def _normalize_scopes(scopes: Sequence[str]) -> Tuple[str, ...]:
    if isinstance(scopes, (str, bytes)):
        raise AgentDelegationError("invalid_configuration", "scopes must be a non-empty sequence")
    values = sorted({scope.strip() for scope in scopes if isinstance(scope, str) and scope.strip()})
    if not values or any(any(character.isspace() for character in scope) for scope in values):
        raise AgentDelegationError(
            "invalid_configuration",
            "scopes must contain non-empty OAuth scope tokens",
        )
    return tuple(values)


def _validate_constraint_string(value: str, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128 or "\r" in value or "\n" in value:
        raise AgentDelegationError("invalid_configuration", f"{label} is invalid")
    return value.strip()


def _validate_constraint_list(values: Sequence[str], label: str) -> Tuple[str, ...]:
    if isinstance(values, (str, bytes)) or not values or len(values) > 100:
        raise AgentDelegationError(
            "invalid_configuration",
            f"{label} must contain between 1 and 100 values",
        )
    return tuple(dict.fromkeys(_validate_constraint_string(value, label) for value in values))


def _validate_constraints(value: AgentDelegationConstraints) -> AgentDelegationConstraints:
    max_credits = value.max_credits
    if max_credits is not None and (
        not isinstance(max_credits, int) or isinstance(max_credits, bool) or max_credits <= 0
    ):
        raise AgentDelegationError("invalid_configuration", "max_credits must be a positive integer")
    return AgentDelegationConstraints(
        model=_validate_constraint_string(value.model, "model") if value.model is not None else None,
        tool_ids=_validate_constraint_list(value.tool_ids, "tool_ids") if value.tool_ids else (),
        provider_ids=_validate_constraint_list(value.provider_ids, "provider_ids") if value.provider_ids else (),
        run_id=_validate_constraint_string(value.run_id, "run_id") if value.run_id is not None else None,
        max_credits=max_credits,
    )


def _append_constraints(form: list[tuple[str, str]], constraints: AgentDelegationConstraints) -> None:
    if constraints.model is not None:
        form.append(("model", constraints.model))
    if constraints.run_id is not None:
        form.append(("run_id", constraints.run_id))
    if constraints.max_credits is not None:
        form.append(("max_credits", str(constraints.max_credits)))
    form.extend(("tool_ids", value) for value in constraints.tool_ids)
    form.extend(("provider_ids", value) for value in constraints.provider_ids)


def _validate_returned_constraints(value: Any, requested: AgentDelegationConstraints) -> None:
    returned: Mapping[str, Any] = value if isinstance(value, dict) else {}
    if requested.model is not None and returned.get("model") != requested.model:
        raise AgentDelegationError(
            "invalid_token_response",
            "Agent token response did not preserve a requested constraint",
        )
    if requested.run_id is not None and returned.get("run_id") != requested.run_id:
        raise AgentDelegationError(
            "invalid_token_response",
            "Agent token response did not preserve a requested constraint",
        )
    if requested.max_credits is not None:
        credits = returned.get("max_credits")
        if not isinstance(credits, int) or isinstance(credits, bool) or credits <= 0 or credits > requested.max_credits:
            raise AgentDelegationError(
                "invalid_token_response",
                "Agent token response widened the credit constraint",
            )
    _validate_returned_list_constraint(returned.get("tool_ids"), requested.tool_ids)
    _validate_returned_list_constraint(returned.get("provider_ids"), requested.provider_ids)


def _validate_returned_list_constraint(value: Any, requested: Tuple[str, ...]) -> None:
    if not requested:
        return
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise AgentDelegationError(
            "invalid_token_response",
            "Agent token response omitted a requested list constraint",
        )
    if not set(value).issubset(requested):
        raise AgentDelegationError(
            "invalid_token_response",
            "Agent token response widened a requested list constraint",
        )
