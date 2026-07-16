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

    def tool_schema(self, tool: Any) -> Dict[str, Any]:
        return tool.metadata.fn_schema.model_json_schema()

    def make_tools(self, client: Any, session_id: Optional[str] = None) -> List[Any]:
        return get_qveris_tools(client, session_id=session_id)

    def make_tools_no_client(self) -> Any:
        return get_qveris_tools()  # type: ignore[call-arg]

    def invoke(self, tool: Any, args: Dict[str, Any]) -> str:
        return run(tool.acall(**args)).raw_output


def test_tools_are_native_function_tools() -> None:
    tools = get_qveris_tools(FakeClient())
    assert all(isinstance(tool, FunctionTool) for tool in tools)


def test_sync_calls_fail_with_async_guidance() -> None:
    discover = get_qveris_tools(FakeClient())[0]
    with pytest.raises(RuntimeError, match="async-only"):
        discover.call(query="weather")
