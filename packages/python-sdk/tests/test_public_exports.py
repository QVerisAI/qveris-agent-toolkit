from qveris import (
    Agent,
    ApiKeyCredentialProvider,
    CatalogVerification,
    CredentialContext,
    CredentialProvider,
    ExecutionRestrictions,
    Message,
    ProbeQuoteResult,
    ProbeRecoveryAdvice,
    ProbeSchemaResult,
    ProbeSchemaViolation,
    ProbeUnknownResult,
    QverisApiError,
    QverisClient,
    QverisError,
    RequestMetadata,
    SearchResponse,
    ToolExecutionResponse,
    ToolProbeResponse,
    VerificationCheck,
)
from qveris.client import (
    CALL_TOOL_DEF,
    DEFAULT_SYSTEM_PROMPT,
    DISCOVER_TOOL_DEF,
    EXECUTE_TOOL_DEF,
    GET_TOOLS_BY_IDS_TOOL_DEF,
    INSPECT_TOOL_DEF,
    SEARCH_TOOL_DEF,
)
from qveris.types import ToolInfo, ToolParameter


def test_public_sdk_exports_cover_core_classes_and_models() -> None:
    assert Agent.__name__ == "Agent"
    assert QverisClient.__name__ == "QverisClient"
    assert issubclass(QverisApiError, QverisError)
    assert RequestMetadata(operation="discover").http_attempts == 0
    assert ApiKeyCredentialProvider.__name__ == "ApiKeyCredentialProvider"
    assert CredentialContext(resource="https://qveris.ai/api/v1").scopes == ()
    assert CredentialProvider.__name__ == "CredentialProvider"
    assert Message(role="user", content="hello").role == "user"
    assert SearchResponse(results=[{"tool_id": "tool-1"}]).results[0].tool_id == "tool-1"
    assert ToolExecutionResponse(execution_id="exec-1", success=True).success is True
    violation = ProbeSchemaViolation(type="required", message="city is required", param="city")
    schema = ProbeSchemaResult(valid=False, violations=[violation])
    quote = ProbeQuoteResult(currency="credits", exact=False, estimate_credits=1.5)
    unknown = ProbeUnknownResult(verdict="unknown", reason="not available")
    recovery = ProbeRecoveryAdvice(
        missing_fields=["city"],
        safe_fixes=["supply city"],
        retryable=True,
        next_action="probe",
        provider_fallback=False,
    )
    probe = ToolProbeResponse(schema=schema, quote=quote, coverage=unknown, sample=unknown, recovery=recovery)
    assert probe.schema_ is schema
    assert probe.quote is quote
    assert probe.recovery is recovery


def test_tool_models_accept_additive_and_multilingual_api_fields() -> None:
    tool = ToolInfo(
        tool_id="tool-1",
        description={"en": "Weather", "zh": "天气"},
        params=[
            ToolParameter(
                name="city",
                type="string",
                required=True,
                description={"en": "City", "zh": "城市"},
                x_extra="preserved",
            )
        ],
        billing_rule={"price": {"amount_credits": 3}, "x_snapshot": "future-field"},
        x_provider_rank=1,
    )

    assert tool.description == {"en": "Weather", "zh": "天气"}
    assert tool.params is not None
    assert tool.params[0].description == {"en": "City", "zh": "城市"}
    assert tool.params[0].model_extra == {"x_extra": "preserved"}
    assert tool.billing_rule is not None
    assert tool.billing_rule.model_extra == {"x_snapshot": "future-field"}
    assert tool.model_extra == {"x_provider_rank": 1}


def test_tool_models_preserve_all_published_parameter_contract_shapes() -> None:
    values = [
        {"city": {"type": "string"}},
        ["opaque"],
        "opaque",
        7,
        1.5,
        True,
        None,
    ]

    for value in values:
        assert ToolInfo(tool_id="tool-1", params=value).params == value

    typed = ToolInfo(
        tool_id="tool-1",
        params=[{"name": "city", "type": "string", "required": True}],
    )
    assert typed.params is not None
    assert isinstance(typed.params[0], ToolParameter)


def test_tool_models_expose_typed_fail_closed_verification_metadata() -> None:
    check = VerificationCheck(name="schema", status="passed", checked_at="2026-09-21T00:00:00Z")
    verification = CatalogVerification(
        status="verified",
        policy_version="2026-09-21",
        required_checks=["schema"],
        checks=[check],
        verified_at="2026-09-21T00:00:00Z",
        expires_at="2026-09-22T00:00:00Z",
        test_run_digest="sha256:" + "a" * 64,
        quality_issues=[],
    )
    restrictions = ExecutionRestrictions(
        callable=True,
        eligibility="not_required",
        license="approved",
        regions={"allow": [], "deny": []},
        commercial_use="allowed",
        warnings=[],
    )
    tool = ToolInfo(
        tool_id="tool-1",
        verification_status="verified",
        verification=verification,
        execution_restrictions=restrictions,
    )

    assert tool.verification.checks[0].name == "schema"
    assert tool.execution_restrictions.callable is True

    legacy = ToolInfo(tool_id="legacy-tool")
    assert legacy.verification_status == "unverified"
    assert legacy.execution_restrictions.callable is False


def test_tool_definitions_expose_canonical_names_and_legacy_aliases() -> None:
    assert "discover, inspect, and call" in DEFAULT_SYSTEM_PROMPT
    assert "this three-tool integration does not expose Probe" in DEFAULT_SYSTEM_PROMPT
    assert "Reuse only exact routes; rebuild current parameters" in DEFAULT_SYSTEM_PROMPT

    assert DISCOVER_TOOL_DEF["function"]["name"] == "discover"
    assert DISCOVER_TOOL_DEF["function"]["parameters"]["required"] == ["query"]

    assert INSPECT_TOOL_DEF["function"]["name"] == "inspect"
    assert INSPECT_TOOL_DEF["function"]["parameters"]["required"] == ["tool_ids"]

    assert CALL_TOOL_DEF["function"]["name"] == "call"
    assert CALL_TOOL_DEF["function"]["parameters"]["required"] == [
        "tool_id",
        "search_id",
        "params_to_tool",
    ]
    assert "current Probe cost quote" in INSPECT_TOOL_DEF["function"]["description"]
    assert "fresh business data such as a stock quote" in INSPECT_TOOL_DEF["function"]["description"]
    assert "Call again for current/latest/today/time-sensitive data" in CALL_TOOL_DEF["function"]["description"]

    assert SEARCH_TOOL_DEF is DISCOVER_TOOL_DEF
    assert GET_TOOLS_BY_IDS_TOOL_DEF is INSPECT_TOOL_DEF
    assert EXECUTE_TOOL_DEF is CALL_TOOL_DEF
