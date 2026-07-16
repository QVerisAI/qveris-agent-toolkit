from typing import Any, Dict, List, Optional

import pytest

pytest.importorskip("autogen_core", reason="AutoGen integration requires autogen-core (Python >=3.10)")

from autogen_core import CancellationToken  # noqa: E402
from autogen_core.tools import FunctionTool  # noqa: E402

from qveris.integrations.autogen import get_qveris_tools  # noqa: E402

from adapter_conformance import AdapterConformance, FakeClient, run  # noqa: E402


class TestAutoGenAdapterConformance(AdapterConformance):
    def make_tools(self, client: Any, session_id: Optional[str] = None) -> List[Any]:
        return get_qveris_tools(client, session_id=session_id)

    def make_tools_no_client(self) -> Any:
        return get_qveris_tools()  # type: ignore[call-arg]

    def tool_schema(self, tool: Any) -> Dict[str, Any]:
        return tool.schema.get("parameters", {})

    def invoke(self, tool: Any, args: Dict[str, Any]) -> str:
        return run(tool.run_json(args, CancellationToken()))


def test_tools_are_native_function_tools() -> None:
    tools = get_qveris_tools(FakeClient())
    assert all(isinstance(tool, FunctionTool) for tool in tools)
