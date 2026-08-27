import json
from collections.abc import AsyncIterator
from typing import Any, Dict, List, Optional

import pytest

pytest.importorskip("agents", reason="OpenAI Agents integration requires openai-agents (Python >=3.10)")

from agents import Agent, Model, ModelResponse, RunConfig, Runner, Usage  # noqa: E402
from agents.tool_context import ToolContext  # noqa: E402
from openai.types.responses import (  # noqa: E402
    Response,
    ResponseCompletedEvent,
    ResponseFunctionToolCall,
    ResponseOutputMessage,
    ResponseOutputText,
)

from qveris.integrations.openai_agents import get_qveris_tools  # noqa: E402

from adapter_conformance import AdapterConformance, FakeClient, run  # noqa: E402


class ScriptedRunnerModel(Model):
    """Minimal provider-free model that drives the public Runner contract.

    ``agents.testing.ScriptedModel`` is not available in the supported 0.20
    SDK line. This uses its public ``Model`` interface instead of introducing
    a third-party test dependency.
    """

    def __init__(self, outputs: List[Any]) -> None:
        self._outputs = list(outputs)
        self.inputs: List[Any] = []

    def _next_response(self) -> ModelResponse:
        if not self._outputs:
            raise AssertionError("Runner made more model calls than scripted")
        return ModelResponse(output=[self._outputs.pop(0)], usage=Usage(), response_id="scripted-response")

    async def get_response(self, system_instructions: Any, input: Any, *_args: Any, **_kwargs: Any) -> ModelResponse:
        del system_instructions
        self.inputs.append(input)
        return self._next_response()

    def stream_response(self, system_instructions: Any, input: Any, *_args: Any, **_kwargs: Any) -> AsyncIterator[Any]:
        del system_instructions

        async def stream() -> AsyncIterator[Any]:
            self.inputs.append(input)
            response = self._next_response()
            yield ResponseCompletedEvent(
                type="response.completed",
                sequence_number=0,
                response=Response(
                    id=response.response_id or "scripted-response",
                    created_at=0,
                    model="scripted",
                    object="response",
                    output=response.output,
                    parallel_tool_calls=False,
                    tool_choice="auto",
                    tools=[],
                ),
            )

        return stream()

    def assert_complete(self) -> None:
        assert not self._outputs, "Runner did not consume the complete model script"


def _scripted_discover_call() -> ResponseFunctionToolCall:
    return ResponseFunctionToolCall(
        id="fc_discover",
        call_id="call_discover",
        name="qveris_discover",
        arguments=json.dumps({"query": "weather forecast API", "limit": 1}),
        status="completed",
        type="function_call",
    )


def _scripted_final_message() -> ResponseOutputMessage:
    return ResponseOutputMessage(
        id="msg_final",
        content=[
            ResponseOutputText(
                annotations=[],
                text="Found the weather capability.",
                type="output_text",
            )
        ],
        role="assistant",
        status="completed",
        type="message",
    )


def _assert_runner_contract(client: FakeClient, model: ScriptedRunnerModel, final_output: str) -> None:
    assert final_output == "Found the weather capability."
    assert client.calls == [
        {
            "name": "discover",
            "args": {"query": "weather forecast API", "limit": 1},
            "session_id": "runner-session",
        }
    ]
    assert len(model.inputs) == 2
    assert any(
        item.get("type") == "function_call_output" and item.get("call_id") == "call_discover"
        for item in model.inputs[1]
        if isinstance(item, dict)
    )
    model.assert_complete()


class TestOpenAIAgentsAdapterConformance(AdapterConformance):
    """Shared invariants (see adapter_conformance.py) for the OpenAI Agents adapter."""

    def make_tools(self, client: Any, session_id: Optional[str] = None) -> List[Any]:
        return get_qveris_tools(client, session_id=session_id)

    def make_tools_no_client(self) -> Any:
        return get_qveris_tools()  # type: ignore[call-arg]

    def tool_schema(self, tool: Any) -> Dict[str, Any]:
        return tool.params_json_schema

    def invoke(self, tool: Any, args: Dict[str, Any]) -> str:
        ctx = ToolContext(
            context=None,
            tool_name=tool.name,
            tool_call_id="call-1",
            tool_arguments=json.dumps(args),
        )
        return run(tool.on_invoke_tool(ctx, json.dumps(args)))


def test_discover_is_strict_but_dict_taking_tools_are_not() -> None:
    # strict JSON schema can't represent free-form dicts / optionals, so
    # inspect/call must be non-strict while discover stays strict.
    tools = {t.name: t for t in get_qveris_tools(FakeClient())}
    assert tools["qveris_discover"].strict_json_schema is True
    assert tools["qveris_inspect"].strict_json_schema is False
    assert tools["qveris_call"].strict_json_schema is False


@pytest.mark.asyncio
async def test_runner_executes_discover_once_and_links_its_output() -> None:
    client = FakeClient()
    model = ScriptedRunnerModel([_scripted_discover_call(), _scripted_final_message()])
    agent = Agent(
        name="QVeris test agent",
        model=model,
        tools=get_qveris_tools(client, session_id="runner-session"),
    )

    result = await Runner.run(agent, "Find a weather capability.", run_config=RunConfig(tracing_disabled=True))

    _assert_runner_contract(client, model, result.final_output)


@pytest.mark.asyncio
async def test_streamed_runner_matches_non_streaming_tool_execution() -> None:
    client = FakeClient()
    model = ScriptedRunnerModel([_scripted_discover_call(), _scripted_final_message()])
    agent = Agent(
        name="QVeris test agent",
        model=model,
        tools=get_qveris_tools(client, session_id="runner-session"),
    )

    result = Runner.run_streamed(agent, "Find a weather capability.", run_config=RunConfig(tracing_disabled=True))
    events = [event async for event in result.stream_events()]

    assert events
    _assert_runner_contract(client, model, result.final_output)
