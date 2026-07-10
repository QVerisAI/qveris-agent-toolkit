import json
from typing import Any, Dict, List, Optional

import pytest

pytest.importorskip("agents", reason="OpenAI Agents integration requires openai-agents (Python >=3.10)")

from agents.tool_context import ToolContext  # noqa: E402

from qveris.integrations.openai_agents import get_qveris_tools  # noqa: E402

from adapter_conformance import AdapterConformance, FakeClient, run  # noqa: E402


class TestOpenAIAgentsAdapterConformance(AdapterConformance):
    """Shared invariants (see adapter_conformance.py) for the OpenAI Agents adapter."""

    def make_tools(self, client: Any, session_id: Optional[str] = None) -> List[Any]:
        return get_qveris_tools(client, session_id=session_id)

    def make_tools_no_client(self) -> Any:
        return get_qveris_tools()  # type: ignore[call-arg]

    def invoke(self, tool: Any, args: Dict[str, Any]) -> str:
        ctx = ToolContext(
            context=None,
            tool_name=tool.name,
            tool_call_id="call-1",
            tool_arguments=json.dumps(args),
        )
        return run(tool.on_invoke_tool(ctx, json.dumps(args)))


# --- OpenAI-Agents-specific behavior ------------------------------------------


def test_tool_schemas_expose_expected_properties() -> None:
    tools = get_qveris_tools(FakeClient())
    props = {t.name: set(t.params_json_schema.get("properties", {})) for t in tools}
    assert props["qveris_discover"] == {"query", "limit"}
    assert props["qveris_inspect"] == {"tool_ids", "search_id"}
    assert props["qveris_call"] == {"tool_id", "search_id", "params_to_tool", "max_response_size"}


def test_discover_is_strict_but_dict_taking_tools_are_not() -> None:
    # strict JSON schema can't represent free-form dicts / optionals, so
    # inspect/call must be non-strict while discover stays strict.
    tools = {t.name: t for t in get_qveris_tools(FakeClient())}
    assert tools["qveris_discover"].strict_json_schema is True
    assert tools["qveris_inspect"].strict_json_schema is False
    assert tools["qveris_call"].strict_json_schema is False
