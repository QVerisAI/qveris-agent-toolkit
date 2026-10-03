import json
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from qveris.integrations._workflow import ProbeArgs, build_qveris_workflow


@pytest.mark.asyncio
async def test_probe_binds_host_identity_and_session_correlation():
    client = type("FixtureClient", (), {"probe": AsyncMock(return_value={"quote": {"exact": False}})})()
    workflow = build_qveris_workflow(client, include_probe=True, session_id="host-session", sub_user_id="host-user")
    result = await workflow.probe("t1", parameters={"city": "London"}, checks=["quote"], live_budget="metadata")
    assert json.loads(result) == {"quote": {"exact": False}}
    client.probe.assert_awaited_once_with(
        "t1",
        parameters={"city": "London"},
        checks=["quote"],
        live_budget="metadata",
        sub_user_id="host-user",
        correlation_id="host-session",
    )
    assert "use qveris_probe" in workflow.discover.__doc__
    assert "does not expose Probe" not in workflow.inspect.__doc__


@pytest.mark.asyncio
async def test_empty_checks_fail_before_any_probe_request():
    with pytest.raises(ValidationError):
        ProbeArgs(tool_id="t1", checks=[])
    client = type("FixtureClient", (), {"probe": AsyncMock()})()
    workflow = build_qveris_workflow(client, include_probe=True)
    with pytest.raises(ValueError, match="at least one"):
        await workflow.probe("t1", checks=[])
    client.probe.assert_not_awaited()


@pytest.mark.parametrize("adapter", ["langchain", "openai_agents", "autogen", "llamaindex", "pydantic_ai", "crewai"])
def test_native_adapters_keep_default_tools_and_offer_probe(adapter):
    import importlib

    module = importlib.import_module(f"qveris.integrations.{adapter}")
    client = type("FixtureClient", (), {"probe": AsyncMock()})()
    try:
        default = module.get_qveris_tools(client)
        optional = module.get_qveris_tools(client, include_probe=True)
    except ImportError:
        pytest.skip(f"{adapter} extra absent")
    assert len(default) == 3
    assert len(optional) == 4
    last = optional[-1]
    name = last.metadata.name if adapter == "llamaindex" else last.name
    assert name == "qveris_probe"
    if adapter in {"langchain", "crewai"}:
        schema = last.args_schema.model_json_schema()
    elif adapter == "openai_agents":
        schema = last.params_json_schema
    elif adapter == "autogen":
        schema = last.schema["parameters"]
    elif adapter == "llamaindex":
        schema = last.metadata.fn_schema.model_json_schema()
    else:
        schema = last.function_schema.json_schema
    checks = schema["properties"]["checks"]
    variants = checks.get("anyOf", [checks])
    assert next(v for v in variants if v.get("type") == "array")["minItems"] == 1
