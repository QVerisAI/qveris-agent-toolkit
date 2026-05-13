from qveris import Agent, Message, QverisClient, SearchResponse, ToolExecutionResponse
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
    assert Message(role="user", content="hello").role == "user"
    assert SearchResponse(results=[{"tool_id": "tool-1"}]).results[0].tool_id == "tool-1"
    assert ToolExecutionResponse(execution_id="exec-1", success=True).success is True


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


def test_tool_definitions_expose_canonical_names_and_legacy_aliases() -> None:
    assert "discover, inspect, and call" in DEFAULT_SYSTEM_PROMPT

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

    assert SEARCH_TOOL_DEF is DISCOVER_TOOL_DEF
    assert GET_TOOLS_BY_IDS_TOOL_DEF is INSPECT_TOOL_DEF
    assert EXECUTE_TOOL_DEF is CALL_TOOL_DEF
