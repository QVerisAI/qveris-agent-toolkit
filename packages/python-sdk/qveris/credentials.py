"""Credential providers for authenticated QVeris API requests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Tuple


@dataclass(frozen=True)
class CredentialContext:
    """Context supplied whenever the client requests a credential."""

    resource: str
    scopes: Tuple[str, ...] = ()


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
    try:
        credential = await provider.get_credential(context)
    except Exception:
        raise RuntimeError("QVeris credential provider failed to provide a credential") from None
    if not isinstance(credential, str) or not credential.strip() or "\r" in credential or "\n" in credential:
        raise ValueError("QVeris credential provider returned an invalid credential")
    return credential.strip()
