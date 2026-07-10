from typing import Any, Dict, List, Optional

import pytest

pytest.importorskip("langchain_core", reason="LangChain integration requires langchain-core (Python >=3.9)")

from qveris.integrations.langchain import get_qveris_tools  # noqa: E402

from adapter_conformance import AdapterConformance, FakeClient, run  # noqa: E402


class TestLangChainAdapterConformance(AdapterConformance):
    """Shared invariants (see adapter_conformance.py) for the LangChain adapter."""

    def make_tools(self, client: Any, session_id: Optional[str] = None) -> List[Any]:
        return get_qveris_tools(client, session_id=session_id)

    def make_tools_no_client(self) -> Any:
        return get_qveris_tools()  # type: ignore[call-arg]

    def invoke(self, tool: Any, args: Dict[str, Any]) -> str:
        return run(tool.ainvoke(args))


# --- LangChain-specific behavior ---------------------------------------------


def test_tools_are_structured_tools_with_args_schemas() -> None:
    from langchain_core.tools import StructuredTool

    tools = get_qveris_tools(FakeClient())
    for tool in tools:
        assert isinstance(tool, StructuredTool)
        assert tool.args_schema is not None
        assert tool.coroutine is not None, "tools must be async-native"
