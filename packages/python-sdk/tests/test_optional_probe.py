import json
from unittest.mock import AsyncMock

import pytest

from qveris.integrations._workflow import build_qveris_workflow


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
