"""Executed with -I from an isolated installed-package environment."""

import asyncio
import importlib.metadata
import json
from pathlib import Path
import sys

import httpx
import qveris
from qveris import CapabilityQueryRequest, QverisClient, QverisConfig
from qveris.errors import QverisApiError, QverisContractError, QverisTransportError
from qveris.generated import openapi_models

fixtures = json.loads(Path(__file__).with_name("fixtures.json").read_text())
installed = Path(qveris.__file__).resolve()
assert Path(sys.prefix).resolve() in installed.parents, installed
assert installed.with_name("CHANGELOG.md").is_file()
assert openapi_models.__file__
for name in qveris.__all__:
    assert getattr(qveris, name) is not None, name


async def main():
    requests = []

    def handler(request):
        requests.append(request)
        fixture = "capability_detail" if request.method == "GET" else "capability_query"
        return httpx.Response(200, json=fixtures[fixture]["response"])

    config = QverisConfig(api_key="fixture-credential", base_url="https://qveris.ai/api/v1", max_retries=3)
    client = QverisClient(config, transport=httpx.MockTransport(handler))
    try:
        detail = await client.capability_detail("MKT/BARS")
        assert detail.capability_id == fixtures["capability_detail"]["response"]["capability_id"]
        assert b"MKT%2FBARS" in requests[0].url.raw_path
        result = await client.capability_query(CapabilityQueryRequest(**fixtures["capability_query"]["request"]))
        assert result.execution_id == fixtures["capability_query"]["response"]["execution_id"]
        assert json.loads(requests[1].content) == fixtures["capability_query"]["request"]
    finally:
        await client.close()

    for kind in [
        401,
        429,
        503,
        307,
        308,
        "network",
        "timeout",
        "invalid_json",
        "invalid_contract",
        "execution_identity",
    ]:
        requests = []

        def fail(request):
            requests.append(request)
            if kind == "network":
                raise httpx.ConnectError("synthetic transport failure", request=request)
            if kind == "timeout":
                raise httpx.ReadTimeout("synthetic timeout", request=request)
            if kind == "invalid_json":
                return httpx.Response(200, content=b"{")
            if isinstance(kind, str):
                return httpx.Response(
                    200,
                    json={
                        "success": "true",
                        **({"execution_id": "fixture-execution"} if kind == "execution_identity" else {}),
                    },
                )
            return httpx.Response(
                kind,
                json={"message": "fixture failure"},
                headers={"Location": "/replay", "Retry-After": "0"},
            )

        client = QverisClient(config, transport=httpx.MockTransport(fail))
        try:
            try:
                await client.capability_query(CapabilityQueryRequest(query="weather"))
            except (QverisApiError, QverisTransportError, QverisContractError) as error:
                assert error.request_metadata.http_attempts == 1
                assert error.next_action["automatic"] is False
                if isinstance(kind, str):
                    assert error.next_action["action"] == (
                        "reconcile_settlement" if kind == "execution_identity" else "review_settlement"
                    )
                if kind == "execution_identity":
                    assert error.execution_id == "fixture-execution"
            else:
                raise AssertionError("Query failure unexpectedly succeeded")
            assert len(requests) == 1
        finally:
            await client.close()


asyncio.run(main())
print(
    "Installed Python package",
    importlib.metadata.version("qveris"),
    ": exports, Detail/Query, single-submit and recovery passed",
)
