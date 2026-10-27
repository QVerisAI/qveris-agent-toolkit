import pytest
import httpx

from qveris.client.access_mode import assert_operation_access, resolve_access_mode


def test_public_mode_requires_explicit_opt_in():
    assert resolve_access_mode() == "authenticated"
    assert resolve_access_mode(False, True) == "authenticated"
    assert resolve_access_mode(True) == "public-read-only"
    for invalid in ("true", 1, None):
        with pytest.raises(ValueError, match="explicit boolean"):
            resolve_access_mode(invalid)


def test_public_mode_cannot_ignore_credentials():
    with pytest.raises(ValueError, match="cannot be combined with credentials"):
        resolve_access_mode(True, True)


@pytest.mark.parametrize(
    "headers",
    [
        {"Authorization": "Bearer valid-synthetic"},
        {"authorization": "Bearer invalid-synthetic"},
        {"AUTHORIZATION": ""},
        {"Authorization": "malformed"},
        [("Authorization", ""), ("Authorization", "Bearer synthetic")],
        httpx.Headers({"Authorization": ""}),
        {"Cookie": ""},
        httpx.Headers({"cookie": "synthetic-session=value"}),
    ],
)
def test_public_mode_rejects_authentication_headers_by_presence(headers):
    with pytest.raises(ValueError, match="cannot be combined with credentials"):
        resolve_access_mode(True, headers=headers)
    assert resolve_access_mode(headers=headers) == "authenticated"


def test_public_mode_rejects_session_proof_but_allows_non_authentication_headers():
    with pytest.raises(ValueError, match="cannot be combined with credentials"):
        resolve_access_mode(True, has_session_proof=True)
    assert resolve_access_mode(True, headers={"Content-Type": "application/json"}) == "public-read-only"


@pytest.mark.parametrize("operation", ["discover", "inspect"])
def test_allowed_public_operations(operation):
    assert_operation_access("public-read-only", operation)


@pytest.mark.parametrize(
    "operation", ["probe", "call", "credits", "usage", "ledger", "history", "models", "capability_query"]
)
def test_public_mode_rejects_other_operations_but_preserves_authenticated_access(operation):
    with pytest.raises(ValueError, match="only supports Discover and Inspect"):
        assert_operation_access("public-read-only", operation)
    assert_operation_access("authenticated", operation)
