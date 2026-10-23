"""Validate request coverage and actual HTTP serialization, including OAuth identity."""

import inspect
import contextlib
import json
from pathlib import Path
from typing import Optional

import httpx
import pytest

from qveris import QverisClient, QverisConfig
from qveris.errors import QverisApiError
from qveris.integrations._workflow import build_qveris_workflow

ROOT = Path(__file__).resolve().parents[3]
CONTRACTS = json.loads((ROOT / "contracts/public-client-requests.v1.json").read_text(encoding="utf-8"))
SCHEMAS = json.loads((ROOT / "docs/openapi/qveris-public-api.openapi.json").read_text(encoding="utf-8"))["components"][
    "schemas"
]


@pytest.mark.asyncio
@pytest.mark.parametrize("identity", [None, "tenant-user", "用户/tenant-a"])
async def test_adapter_and_dispatch_preserve_only_host_identity_at_http(identity: Optional[str]) -> None:
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"execution_id": "exec-adapter", "success": True})

    client = QverisClient(QverisConfig(api_key="sk-fixture"))
    client.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        workflow = build_qveris_workflow(client, sub_user_id=identity)
        result = json.loads(await workflow.call("tool-fixture", {}))
        assert result["success"] is True
        for name in ("call", "execute_tool"):
            _, is_error, handled = await client.handle_tool_call(
                name,
                {"tool_id": "tool-fixture", "params_to_tool": {}, "sub_user_id": "forged"},
                sub_user_id=identity,
            )
            assert handled and not is_error
        assert len(requests) == 3
        for body in requests:
            assert ("sub_user_id" in body) == (identity is not None)
            assert body.get("sub_user_id") == identity
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["call", "probe"])
@pytest.mark.parametrize("identity", [None, "tenant-user-fixture", "用户/tenant-A"])
async def test_public_request_fields_reach_http(operation: str, identity: Optional[str]) -> None:
    contract = CONTRACTS[operation]
    body = dict(contract["body"])
    assert set(body) | set(contract["query_fields"]) == set(SCHEMAS[contract["schema"]]["properties"])
    assert set(body) <= set(inspect.signature(getattr(QverisClient, operation)).parameters)
    if identity is None:
        del body["sub_user_id"]
    else:
        body["sub_user_id"] = identity
    attempts = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(request)
        assert request.url.params["tool_id"] == "tool/fixture"
        assert json.loads(request.content) == body
        return httpx.Response(
            200,
            json={
                "execution_id": "exec-fixture",
                "success": True,
                "result": {},
                "recovery": {
                    "missing_fields": [],
                    "safe_fixes": [],
                    "retryable": False,
                    "next_action": "execute",
                    "provider_fallback": False,
                },
            },
        )

    client = QverisClient(QverisConfig(api_key="sk-fixture", base_url="https://qveris.ai/api/v1"))
    client.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        await getattr(client, operation)("tool/fixture", **body)
    finally:
        await client.close()
    assert len(attempts) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("compatibility_mode", ["strict", "legacy_optional_fields"])
async def test_identity_rejection_never_falls_back(compatibility_mode: str) -> None:
    attempts = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(request)
        assert json.loads(request.content)["sub_user_id"] == "tenant-user-fixture"
        return httpx.Response(422, json={"detail": [{"type": "extra_forbidden", "loc": ["body", "sub_user_id"]}]})

    client = QverisClient(QverisConfig(api_key="sk-fixture", base_url="https://qveris.ai/api/v1"))
    client.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        assert client._redact_sensitive({"sub_user_id": "tenant-user-fixture"}) == {"sub_user_id": "***"}
        warning = (
            pytest.warns(DeprecationWarning)
            if compatibility_mode == "legacy_optional_fields"
            else contextlib.nullcontext()
        )
        with warning, pytest.raises(QverisApiError):
            await client.call(
                "tool-fixture", {}, sub_user_id="tenant-user-fixture", compatibility_mode=compatibility_mode
            )
    finally:
        await client.close()
    assert len(attempts) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("guard", [None, False, True])
async def test_explicit_zero_quote_guard_is_single_submit_without_preflight(guard):
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        assert request.method == "POST"
        assert request.url.path.endswith("/tools/execute")
        return httpx.Response(200, json={"execution_id": "exec-guard", "success": True})

    client = QverisClient(QverisConfig(api_key="sk-fixture"))
    client.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        await client.call("tool-fixture", {}, require_zero_quote=guard)
    finally:
        await client.close()
    assert len(requests) == 1
    assert ("require_zero_quote" in requests[0]) == (guard is not None)
    assert requests[0].get("require_zero_quote") is guard


@pytest.mark.asyncio
async def test_rejected_zero_quote_guard_does_not_replay_or_allow_legacy_mode():
    attempts = []

    def handler(request):
        attempts.append(json.loads(request.content))
        return httpx.Response(
            422, json={"detail": [{"type": "extra_forbidden", "loc": ["body", "require_zero_quote"]}]}
        )

    client = QverisClient(QverisConfig(api_key="sk-fixture"))
    client.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(QverisApiError) as error:
            await client.call("tool-fixture", {}, require_zero_quote=True)
        assert error.value.status == 422
        assert len(attempts) == 1
        with pytest.raises(ValueError, match="requires strict compatibility mode"):
            await client.call("tool-fixture", {}, require_zero_quote=True, compatibility_mode="legacy_optional_fields")
        assert len(attempts) == 1
    finally:
        await client.close()
