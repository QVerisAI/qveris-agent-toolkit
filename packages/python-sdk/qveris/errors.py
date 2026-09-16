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


def _execution_id_from(details: Any) -> Optional[str]:
    if not isinstance(details, dict):
        return None
    execution_id = details.get("execution_id")
    if isinstance(execution_id, str) and execution_id.strip():
        return execution_id
    data = details.get("data")
    if not isinstance(data, dict):
        return None
    execution_id = data.get("execution_id")
    return execution_id if isinstance(execution_id, str) and execution_id.strip() else None


def _unknown_call_action(execution_id: Optional[str] = None) -> Dict[str, Any]:
    if execution_id:
        return _next_action("reconcile_settlement", False, "call_outcome_may_be_unknown")
    return _next_action("review_settlement", True, "execution_id_unavailable")


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
        execution_id = _execution_id_from(details)
        if operation == "call" and execution_id:
            recovery = _unknown_call_action(execution_id)
        elif status == 401:
            recovery = _next_action("authenticate", True)
        elif status == 402:
            recovery = _next_action("add_credits", True)
        elif status == 403:
            recovery = _next_action("request_permission", True)
        elif operation == "call" and (status in {0, 408, 429} or 200 <= status < 300 or status >= 500):
            recovery = _unknown_call_action()
        elif operation == "call" and status in {400, 422}:
            recovery = _next_action("correct_parameters", True, "invalid_call_request")
        elif operation == "call" and 400 <= status < 500:
            recovery = _next_action("review_request", True, "call_rejected")
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
        recovery = _unknown_call_action() if operation == "call" else _next_action("retry", False, "safe_read_retry")
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

    def __init__(
        self,
        message: str,
        *,
        operation: str,
        request_metadata: RequestMetadata,
        next_action: Optional[Dict[str, Any]] = None,
        execution_id: Optional[str] = None,
    ) -> None:
        recovery = next_action
        if recovery is None and operation == "call":
            recovery = _unknown_call_action(execution_id)
        super().__init__(
            message,
            operation=operation,
            request_metadata=request_metadata,
            next_action=recovery,
        )
        self.execution_id = execution_id


class QverisClientClosedError(QverisError):
    """The client is closing or has already been closed."""
