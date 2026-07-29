"""Public, credential-safe exceptions and request metadata."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional


@dataclass(frozen=True)
class RequestMetadata:
    """Client-side metadata for one logical SDK operation."""

    operation: str
    http_attempts: int = 0
    retry_attempts: int = 0
    compatibility_replays: int = 0
    request_id: Optional[str] = None
    elapsed_ms: float = 0.0


class QverisError(Exception):
    """Base class for public SDK errors.

    These errors intentionally never retain an HTTP request, response, bearer
    credential, or lower-level exception object.
    """

    def __init__(
        self,
        message: str,
        *,
        operation: str,
        request_metadata: RequestMetadata,
    ) -> None:
        super().__init__(message)
        self.operation = operation
        self.request_metadata = request_metadata


class QverisApiError(QverisError):
    """A safe representation of an HTTP or API-envelope failure."""

    def __init__(
        self,
        message: str,
        *,
        status: int,
        operation: str,
        request_metadata: RequestMetadata,
        code: Optional[str] = None,
        category: Optional[str] = None,
        details: Any = None,
    ) -> None:
        super().__init__(message, operation=operation, request_metadata=request_metadata)
        self.status = status
        self.code = code
        self.category = category
        self.details = details


class QverisTransportError(QverisError):
    """A safe transport failure without the original transport exception."""

    def __init__(
        self,
        message: str,
        *,
        error_type: str,
        operation: str,
        request_metadata: RequestMetadata,
    ) -> None:
        super().__init__(message, operation=operation, request_metadata=request_metadata)
        self.error_type = error_type
        self.status = 408 if error_type == "timeout" else 0


class QverisCredentialError(QverisError):
    """Credential acquisition failed without exposing provider internals."""

    def __init__(
        self,
        message: str,
        *,
        operation: str,
        request_metadata: RequestMetadata,
    ) -> None:
        super().__init__(message, operation=operation, request_metadata=request_metadata)
        self.status = 0


class QverisContractError(QverisError):
    """The API returned an invalid or explicit failure envelope."""


class QverisClientClosedError(QverisError):
    """The client is closing or has already been closed."""
