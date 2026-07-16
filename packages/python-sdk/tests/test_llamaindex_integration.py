from typing import Any, Dict, List, Optional

import pytest

pytest.importorskip("llama_index.core", reason="LlamaIndex integration requires llama-index-core (Python >=3.10)")

from llama_index.core.tools import FunctionTool  # noqa: E402

from qveris.integrations.llamaindex import get_qveris_tools  # noqa: E402

from adapter_conformance import AdapterConformance, FakeClient, run  # noqa: E402


class TestLlamaIndexAdapterConformance(AdapterConformance):
    def tool_name(self, tool: Any) -> str:
        return tool.metadata.name

    def tool_description(self, tool: Any) -> str:
        return tool.metadata.description

    def make_tools(self, client: Any, session_id: Optional[str] = None) -> List[Any]:
        return get_qveris_tools(client, session_id=session_id)

    def make_tools_no_client(self) -> Any:
        return get_qveris_tools()  # type: ignore[call-arg]

    def invoke(self, tool: Any, args: Dict[str, Any]) -> str:
        return run(tool.acall(**args)).raw_output


def test_tools_are_native_function_tools_with_expected_schemas() -> None:
    tools = get_qveris_tools(FakeClient())
    assert all(isinstance(tool, FunctionTool) for tool in tools)
    props = {
        tool.metadata.name: set(tool.metadata.fn_schema.model_json_schema().get("properties", {})) for tool in tools
    }
    assert props["qveris_discover"] == {"query", "limit"}
    assert props["qveris_inspect"] == {"tool_ids", "search_id"}
    assert props["qveris_call"] == {"tool_id", "params_to_tool", "search_id", "max_response_size"}
