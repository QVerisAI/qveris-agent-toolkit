"""Local read-only access policy, independent of public HTTP contracts."""

from typing import Literal, Mapping, Optional, Sequence, Tuple, Union

ClientAccessMode = Literal["authenticated", "public-read-only"]
AuthenticationHeaders = Union[Mapping[str, object], Sequence[Tuple[str, object]]]
AUTHENTICATION_HEADERS = frozenset(
    {
        "authorization",
        "cookie",
        "mcp-session-id",
        "x-qveris-trial-session-token",
        "x-qveris-claim-account-token",
        "x-qveris-trial-csrf",
        "x-qveris-hosted-mcp-context",
        "x-qveris-hosted-mcp-signature",
        "x-qveris-credential-context",
        "x-qveris-credential-signature",
    }
)


def resolve_access_mode(
    public_read_only: bool = False,
    has_credentials: bool = False,
    *,
    headers: Optional[AuthenticationHeaders] = None,
    has_session_proof: bool = False,
) -> ClientAccessMode:
    if not isinstance(public_read_only, bool):
        raise ValueError("Public read-only access requires an explicit boolean option")
    if not public_read_only:
        return "authenticated"
    names = headers.keys() if isinstance(headers, Mapping) else (name for name, _ in (headers or ()))
    if has_credentials or has_session_proof or any(name.lower() in AUTHENTICATION_HEADERS for name in names):
        raise ValueError("Public read-only mode cannot be combined with credentials")
    return "public-read-only"


def assert_operation_access(mode: ClientAccessMode, operation: str) -> None:
    if mode == "public-read-only" and operation not in {"discover", "inspect"}:
        raise ValueError(
            "Public read-only mode only supports Discover and Inspect. Authenticate and refresh discovery first."
        )
