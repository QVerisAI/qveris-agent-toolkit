import math

from examples._shared import supports_parameters
from qveris import ToolInfo, ToolParameter


def parameter(name: str, type_: str, *, required: bool = False, enum=None) -> ToolParameter:
    return ToolParameter(name=name, type=type_, required=required, enum=enum)


def tool(params=None) -> ToolInfo:
    return ToolInfo(tool_id="provider.tool", params=params)


def test_supports_parameters_accepts_compatible_json_values_and_enum_members() -> None:
    candidate = tool(
        [
            parameter("city", "string", required=True, enum=["London", "Paris"]),
            parameter("days", "number"),
            parameter("alerts", "boolean"),
            parameter("tags", "array"),
            parameter("options", "object"),
        ]
    )

    assert supports_parameters(
        candidate,
        {"city": "London", "days": 3, "alerts": False, "tags": [], "options": {}},
    )


def test_supports_parameters_rejects_incompatible_contracts() -> None:
    assert not supports_parameters(tool(None), {"city": "London"})
    assert not supports_parameters(tool([parameter("city", "string", required=True)]), {})
    assert not supports_parameters(tool([parameter("city", "string")]), {"city": 42})
    assert not supports_parameters(tool([parameter("city", "string", enum=["Paris"])]), {"city": "London"})
    assert not supports_parameters(tool([parameter("days", "number")]), {"days": math.inf})
    assert not supports_parameters(tool([parameter("days", "number")]), {"days": True})
    assert not supports_parameters(tool([parameter("options", "object")]), {"options": []})
    assert not supports_parameters(tool([parameter("city", "date")]), {"city": "2026-09-07"})
    assert not supports_parameters(tool([parameter("city", "string")]), {"symbol": "AAPL"})
    assert not supports_parameters(
        tool([parameter("city", "string"), parameter("city", "string")]),
        {"city": "London"},
    )


def test_enum_comparison_does_not_treat_booleans_as_numbers() -> None:
    assert not supports_parameters(tool([parameter("value", "integer", enum=[True])]), {"value": 1})
