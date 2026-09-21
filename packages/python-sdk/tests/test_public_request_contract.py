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

ROOT = Path(__file__).resolve().parents[3]
CONTRACTS = json.loads((ROOT / "contracts/public-client-requests.v1.json").read_text())
SCHEMAS = json.loads((ROOT / "docs/openapi/qveris-public-api.openapi.json").read_text())["components"]["schemas"]


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
