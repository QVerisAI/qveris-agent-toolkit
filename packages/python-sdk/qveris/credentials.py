"""Credential providers for authenticated QVeris API requests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional, Protocol, Tuple


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


async def resolve_credential(provider: CredentialProvider, context: CredentialContext) -> str:
    """Resolve a valid credential without including its value in errors."""

    async def attempt() -> _CredentialResult:
        try:
            value = await provider.get_credential(context)
        except Exception:
            return _CredentialResult(error="provider_failed")
        if not isinstance(value, str) or not value.strip() or "\r" in value or "\n" in value:
            return _CredentialResult(error="invalid_credential")
        return _CredentialResult(value=value.strip())

    result = await attempt()
    if result.error == "provider_failed":
        raise CredentialResolutionError("QVeris credential provider failed to provide a credential") from None
    if result.error == "invalid_credential" or result.value is None:
        raise CredentialResolutionError("QVeris credential provider returned an invalid credential") from None
    return result.value
