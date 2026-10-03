import json
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError

from qveris import CapabilityQueryRequest, QverisClient, QverisConfig
from qveris.errors import QverisApiError, QverisContractError, QverisTransportError

FIXTURES = json.loads(
    (Path(__file__).parents[3] / "docs/openapi/qveris-public-api.projection-fixtures.json").read_text()
)


@pytest.mark.asyncio
async def test_published_capability_detail_and_query_fixtures():
    requests = []

    def handler(request):
        requests.append(request)
        fixture = "capability_detail" if request.method == "GET" else "capability_query"
        return httpx.Response(200, json=FIXTURES[fixture]["response"])

    client = QverisClient(QverisConfig(api_key="<fixture-key>"), transport=httpx.MockTransport(handler))
    try:
        detail = await client.capability_detail("MKT/BARS", run_id="run-1", provider_id="provider-1")
        assert detail.capability_id == FIXTURES["capability_detail"]["response"]["capability_id"]
        assert requests[0].url.raw_path.startswith(b"/api/v1/capabilities/MKT%2FBARS?")
        outcome = await client.capability_query(CapabilityQueryRequest(**FIXTURES["capability_query"]["request"]))
        assert outcome.execution_id == FIXTURES["capability_query"]["response"]["execution_id"]
        assert json.loads(requests[1].content) == FIXTURES["capability_query"]["request"]
        assert outcome.request_metadata.operation == "capability_query"
        assert outcome.request_metadata.http_attempts == 1
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["network", "timeout", "invalid_json"])
async def test_query_unknown_transport_outcome_is_not_replayed(kind):
    requests = []

    def handler(request):
        requests.append(request)
        if kind == "network":
            raise httpx.ConnectError("synthetic transport failure", request=request)
        if kind == "timeout":
            raise httpx.ReadTimeout("synthetic timeout", request=request)
        return httpx.Response(200, content=b"{")

    client = QverisClient(QverisConfig(api_key="<fixture-key>", max_retries=3), transport=httpx.MockTransport(handler))
    try:
        with pytest.raises((QverisTransportError, QverisContractError)) as captured:
            await client.capability_query(CapabilityQueryRequest(query="weather"))
        assert captured.value.next_action["action"] == "review_settlement"
        assert captured.value.request_metadata.http_attempts == 1
        assert len(requests) == 1
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_malformed_query_preserves_execution_identity():
    client = QverisClient(
        QverisConfig(api_key="<fixture-key>"),
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"success": "true", "execution_id": "e-1"})),
    )
    try:
        with pytest.raises(QverisContractError) as captured:
            await client.capability_query(CapabilityQueryRequest(query="weather"))
        assert captured.value.next_action["action"] == "reconcile_settlement"
        assert captured.value.execution_id == "e-1"
    finally:
        await client.close()


@pytest.mark.parametrize("payload", [{}, {"query": " "}, {"query": "weather", "max_credits": float("inf")}])
def test_invalid_query_selectors_and_budgets_fail_before_submission(payload):
    with pytest.raises(ValidationError):
        CapabilityQueryRequest(**payload)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 429, 503, 307, 308])
async def test_query_never_replays_http_failures(status):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(
            status, json={"message": "fixture failure"}, headers={"Location": "/replay", "Retry-After": "0"}
        )

    client = QverisClient(QverisConfig(api_key="<fixture-key>", max_retries=3), transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(QverisApiError) as captured:
            await client.capability_query(CapabilityQueryRequest(query="weather"))
        assert captured.value.request_metadata.http_attempts == 1
        assert len(requests) == 1
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_malformed_query_success_requires_settlement_review():
    client = QverisClient(
        QverisConfig(api_key="<fixture-key>"),
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"success": "true"})),
    )
    try:
        with pytest.raises(QverisContractError) as captured:
            await client.capability_query(CapabilityQueryRequest(query="weather"))
        assert captured.value.next_action["action"] == "review_settlement"
        assert captured.value.request_metadata.http_attempts == 1
    finally:
        await client.close()
