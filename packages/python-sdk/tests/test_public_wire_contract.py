"""Exercise public handwritten parsers, not merely the generated reference models.

Every declared field must have a typed SDK attribute. Each nullable/union/enum
arm is fed through the actual model validator; extra="allow" cannot hide drift.
Samples check structural field compatibility, not cross-field policy semantics.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from qveris import types
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[3]
SCHEMAS = json.loads((ROOT / "docs/openapi/qveris-public-api.openapi.json").read_text())["components"]["schemas"]
MODELS = {
    "PublicExecuteToolResponse": types.ToolExecutionResponse,
    "ValidationError": types.ValidationIssue,
    "PublicCapabilityResult": types.ToolInfo,
    "PublicSearchResponse": types.SearchResponse,
    "PublicInspectResponse": types.SearchResponse,
    "PublicToolStats": types.ToolStats,
    "PublicToolCategory": types.ToolCategory,
    "PublicToolCapability": types.ToolCapability,
    "PublicCapabilityTag": types.ToolCapabilityTag,
    "PublicCatalogVerification": types.CatalogVerification,
    "PublicVerificationCheck": types.VerificationCheck,
    "PublicRegionRestrictions": types.RegionRestrictions,
    "PublicExecutionRestrictions": types.ExecutionRestrictions,
    "PublicToolProbeResponse": types.ToolProbeResponse,
    "PublicProbeRecoveryAdvice": types.ProbeRecoveryAdvice,
    "PublicProbeSchemaResult": types.ProbeSchemaResult,
    "PublicProbeSchemaViolation": types.ProbeSchemaViolation,
    "PublicProbeQuoteResult": types.ProbeQuoteResult,
    "PublicProbeUnknownResult": types.ProbeUnknownResult,
    "PublicCompactBillingStatement": types.CompactBillingStatement,
}


def test_probe_recovery_is_required_and_non_nullable() -> None:
    payload = samples(SCHEMAS["PublicToolProbeResponse"])[0]
    response = types.ToolProbeResponse.model_validate(payload)
    assert isinstance(response.recovery, types.ProbeRecoveryAdvice)
    assert types.ToolProbeResponse.model_fields["recovery"].is_required()
    for missing in (True, False):
        invalid = {**payload, "recovery": None}
        if missing:
            del invalid["recovery"]
        with pytest.raises(ValidationError):
            types.ToolProbeResponse.model_validate(invalid)


@pytest.mark.parametrize(
    "case",
    json.loads((ROOT / "contracts/result-delivery.v1.json").read_text())["summary_cases"],
    ids=lambda case: case["id"],
)
def test_shared_summary_payloads_survive_public_parser(case: dict[str, Any]) -> None:
    response = types.ToolExecutionResponse.model_validate(
        {
            "execution_id": case["id"],
            "success": case["success"],
            "result": case["result"],
        }
    )
    assert response.result == case["result"]
    assert response.success == case["success"]


def samples(schema: dict[str, Any]) -> list[Any]:
    if "$ref" in schema:
        return samples(SCHEMAS[schema["$ref"].split("/")[-1]])
    if "enum" in schema:
        return schema["enum"]
    if "anyOf" in schema:
        return [value for branch in schema["anyOf"] for value in samples(branch)]
    kind = schema.get("type")
    if isinstance(kind, list):
        return [value for branch in kind for value in samples({**schema, "type": branch})]
    if kind == "object":
        if "properties" in schema:
            return [
                {
                    name: samples(prop)[0]
                    for name, prop in schema["properties"].items()
                    if name in schema.get("required", [])
                }
            ]
        additional = schema.get("additionalProperties", {})
        return [{"en-US": samples(additional if isinstance(additional, dict) else {})[0]}]
    if kind == "array":
        return [[], [samples(schema.get("items", {}))[0]]]
    if kind == "string":
        return ["sample"]
    if kind in ("integer", "number"):
        return [max(1, schema.get("minimum", 0))]
    if kind == "boolean":
        return [True, False]
    if kind == "null":
        return [None]
    return [{"nested": [None, True, 1, "value"]}, [], "value", 1, False, None]


CASES = [
    (name, field, value)
    for name in MODELS
    for field, schema in SCHEMAS[name]["properties"].items()
    for value in samples(schema)
]


@pytest.mark.parametrize("name,field,value", CASES)
def test_public_fields_are_declared_and_parse(name: str, field: str, value: Any) -> None:
    model = MODELS[name]
    fields = {info.alias or key: key for key, info in model.model_fields.items()}
    assert field in fields, f"{name}.{field} is silently falling into model_extra"
    payload = samples(SCHEMAS[name])[0]
    payload[field] = value
    parsed = model.model_validate(payload)
    assert field not in (parsed.model_extra or {})
    assert getattr(parsed, fields[field]) is not None or value is None


@pytest.mark.parametrize("provider", ["Provider", {"en-US": "Provider", "zh-CN": "服务商"}])
def test_localized_provider_survives_discover_and_inspect(provider: Any) -> None:
    tool = samples(SCHEMAS["PublicCapabilityResult"])[0]
    tool["provider_name"] = provider
    for name in ("PublicSearchResponse", "PublicInspectResponse"):
        payload = samples(SCHEMAS[name])[0]
        payload["results"] = [tool]
        response = types.SearchResponse.model_validate(payload)
        assert response.results[0].provider_name == provider
