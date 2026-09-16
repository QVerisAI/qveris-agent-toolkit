"""Public, credential-safe exceptions and request metadata."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


def _next_action(action: str, requires_user: bool, reason: Optional[str] = None) -> Dict[str, Any]:
    value: Dict[str, Any] = {
        "action": action,
        "automatic": False,
        "requires_user": requires_user,
        "missing_fields": [],
    }
    if reason is not None:
        value["reason"] = reason
    return value


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
        next_action: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.operation = operation
        self.request_metadata = request_metadata
        self.next_action = next_action or _next_action("review_and_retry", True)


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
        if status == 401:
            recovery = _next_action("authenticate", True)
        elif status == 402:
            recovery = _next_action("add_credits", True)
        elif status == 403:
            recovery = _next_action("request_permission", True)
        elif operation == "call" and (status in {0, 408} or status >= 500):
            recovery = _next_action("reconcile_settlement", False, "call_outcome_may_be_unknown")
        elif status in {0, 408, 429, 503}:
            recovery = _next_action("retry", False, "safe_read_retry")
        else:
            recovery = _next_action("review_and_retry", True)
        super().__init__(
            message,
            operation=operation,
            request_metadata=request_metadata,
            next_action=recovery,
        )
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
        recovery = (
            _next_action("reconcile_settlement", False, "call_outcome_may_be_unknown")
            if operation == "call"
            else _next_action("retry", False, "safe_read_retry")
        )
        super().__init__(
            message,
            operation=operation,
            request_metadata=request_metadata,
            next_action=recovery,
        )
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
        code: Optional[str] = None,
        status: Optional[int] = None,
    ) -> None:
        super().__init__(
            message,
            operation=operation,
            request_metadata=request_metadata,
            next_action=_next_action("authenticate", True),
        )
        self.code = code
        self.status = status or 0


class QverisContractError(QverisError):
    """The API returned an invalid or explicit failure envelope."""


class QverisClientClosedError(QverisError):
    """The client is closing or has already been closed."""
