from typing import Any, Dict, List, Optional

import pytest

pytest.importorskip("pydantic_ai", reason="Pydantic AI integration requires pydantic-ai-slim (Python >=3.10)")

from pydantic_ai import Tool  # noqa: E402
from pydantic_ai import Agent  # noqa: E402
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart  # noqa: E402
from pydantic_ai.models.function import FunctionModel  # noqa: E402

from qveris.integrations.pydantic_ai import get_qveris_tools  # noqa: E402

from adapter_conformance import AdapterConformance, FakeClient, run  # noqa: E402


class TestPydanticAIAdapterConformance(AdapterConformance):
    def make_tools(self, client: Any, session_id: Optional[str] = None) -> List[Any]:
        return get_qveris_tools(client, session_id=session_id)

    def make_tools_no_client(self) -> Any:
        return get_qveris_tools()  # type: ignore[call-arg]

    def tool_schema(self, tool: Any) -> Dict[str, Any]:
        return tool.function_schema.json_schema

    def invoke(self, tool: Any, args: Dict[str, Any]) -> str:
        model_calls = 0

        def model_function(messages: Any, info: Any) -> ModelResponse:
            nonlocal model_calls
            model_calls += 1
            if model_calls == 1:
                return ModelResponse(parts=[ToolCallPart(tool_name=tool.name, args=args)])
            return ModelResponse(parts=[TextPart("done")])

        result = run(Agent(FunctionModel(model_function), tools=[tool]).run("invoke the tool"))
        tool_returns = [
            part
            for message in result.all_messages()
            for part in message.parts
            if isinstance(part, ToolReturnPart) and part.tool_name == tool.name
        ]
        assert len(tool_returns) == 1
        assert isinstance(tool_returns[0].content, str)
        return tool_returns[0].content


def test_tools_are_native_tools() -> None:
    tools = get_qveris_tools(FakeClient())
    assert all(isinstance(tool, Tool) for tool in tools)
