import json
from typing import Any, Dict, List, Optional

import pytest

from qveris.agent.core import Agent
from qveris.config import AgentConfig, QverisConfig
from qveris.types import ChatResponse, Message


class ToolCallingLLM:
    def __init__(self, first_tool_name: str = "discover") -> None:
        self.first_tool_name = first_tool_name
        self.calls: List[List[Message]] = []
        self.tool_names: List[List[str]] = []

    async def chat(self, messages, tools, config):
        self.calls.append(messages)
        self.tool_names.append([tool["function"]["name"] for tool in tools])

        if len(self.calls) == 1:
            return ChatResponse(
                content="Checking available capabilities.",
                tool_calls=[
                    {
                        "id": "tool-call-1",
                        "type": "function",
                        "function": {
                            "name": self.first_tool_name,
                            "arguments": json.dumps({"query": "weather forecast", "limit": 1}),
                        },
                    }
                ],
            )

        return ChatResponse(content="Forecast ready.", metrics={"total_tokens": 12})

    async def chat_stream(self, messages, tools, config):
        raise AssertionError("streaming path is not used in this test")


class FakeQverisClient:
    def __init__(self, handled: bool = True) -> None:
        self.handled = handled
        self.calls: List[Dict[str, Any]] = []
        self.closed = False

    async def handle_tool_call(
        self,
        func_name: str,
        func_args: Dict[str, Any],
        session_id: Optional[str] = None,
    ):
        self.calls.append({"func_name": func_name, "func_args": func_args, "session_id": session_id})
        if not self.handled:
            return None, False, False
        return {"search_id": "search-1", "results": [{"tool_id": "weather.tool.v1"}]}, False, True

    async def close(self) -> None:
        self.closed = True


async def make_agent(llm, qveris_client: FakeQverisClient) -> Agent:
    agent = Agent(
        config=QverisConfig(api_key="sk-test", max_iterations=3),
        agent_config=AgentConfig(model="unit-test-model"),
        llm_provider=llm,
    )
    await agent.client.close()
    agent.client = qveris_client
    return agent


@pytest.mark.asyncio
async def test_agent_runs_builtin_tool_loop_and_records_reusable_history() -> None:
    llm = ToolCallingLLM()
    qveris_client = FakeQverisClient()
    agent = await make_agent(llm, qveris_client)

    try:
        events = [
            event async for event in agent.run([Message(role="user", content="Find a weather API")], stream=False)
        ]
    finally:
        await agent.close()

    assert [event.type for event in events] == [
        "content",
        "tool_call",
        "tool_result",
        "content",
        "metrics",
    ]
    assert events[2].tool_result is not None
    assert events[2].tool_result["name"] == "discover"
    assert events[2].tool_result["is_error"] is False
    assert llm.tool_names[0] == ["discover", "inspect", "call"]
    assert qveris_client.calls == [
        {
            "func_name": "discover",
            "func_args": {"query": "weather forecast", "limit": 1},
            "session_id": agent.session_id,
        }
    ]

    last_messages = agent.get_last_messages()
    assert [message.role for message in last_messages] == ["user", "assistant", "tool", "assistant"]
    assert last_messages[0].content == "Find a weather API"
    assert last_messages[2].name == "discover"
    assert last_messages[-1].content == "Forecast ready."
    assert qveris_client.closed is True


@pytest.mark.asyncio
async def test_agent_routes_unhandled_tool_calls_to_extra_handler() -> None:
    llm = ToolCallingLLM(first_tool_name="local_calculator")
    qveris_client = FakeQverisClient(handled=False)

    async def extra_tool_handler(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        return {"name": name, "args": args, "value": 42}

    agent = await make_agent(llm, qveris_client)
    agent.extra_tool_handler = extra_tool_handler

    try:
        events = [event async for event in agent.run([Message(role="user", content="Use a local tool")], stream=False)]
    finally:
        await agent.close()

    tool_result = next(event.tool_result for event in events if event.type == "tool_result")
    assert tool_result is not None
    assert tool_result["name"] == "local_calculator"
    assert tool_result["is_error"] is False
    assert tool_result["result"] == {
        "name": "local_calculator",
        "args": {"query": "weather forecast", "limit": 1},
        "value": 42,
    }


class BudgetScenarioLLM:
    """Discover once, then attempt to call `pricey.tool.v1`, then stop."""

    def __init__(self) -> None:
        self.calls = 0

    async def chat(self, messages, tools, config):
        self.calls += 1
        if self.calls == 1:
            return ChatResponse(
                tool_calls=[
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {"name": "discover", "arguments": json.dumps({"query": "x", "limit": 1})},
                    }
                ]
            )
        if self.calls == 2:
            return ChatResponse(
                tool_calls=[
                    {
                        "id": "c2",
                        "type": "function",
                        "function": {
                            "name": "call",
                            "arguments": json.dumps(
                                {"tool_id": "pricey.tool.v1", "search_id": "s1", "params_to_tool": {}}
                            ),
                        },
                    }
                ]
            )
        return ChatResponse(content="done")

    async def chat_stream(self, messages, tools, config):
        raise AssertionError("streaming path is not used in this test")


class BudgetScenarioClient:
    def __init__(self) -> None:
        self.calls: List[str] = []
        self.closed = False

    async def handle_tool_call(self, func_name, func_args, session_id=None):
        self.calls.append(func_name)
        if func_name == "discover":
            return {"search_id": "s1", "results": [{"tool_id": "pricey.tool.v1", "expected_cost": "50"}]}, False, True
        if func_name == "call":
            return {"execution_id": "e1", "success": True, "billing": {"list_amount_credits": 50}}, False, True
        return None, False, False

    async def close(self) -> None:
        self.closed = True


async def _run_budget_agent(budget_credits):
    agent = Agent(
        config=QverisConfig(api_key="sk-test", max_iterations=4),
        agent_config=AgentConfig(model="unit-test-model"),
        llm_provider=BudgetScenarioLLM(),
        budget_credits=budget_credits,
    )
    await agent.client.close()
    client = BudgetScenarioClient()
    agent.client = client
    try:
        events = [event async for event in agent.run([Message(role="user", content="do it")], stream=False)]
    finally:
        await agent.close()
    return agent, client, events


@pytest.mark.asyncio
async def test_agent_blocks_call_over_budget_without_executing() -> None:
    agent, client, events = await _run_budget_agent(budget_credits=10)

    # The call was blocked before reaching the client — only discover ran.
    assert client.calls == ["discover"]
    types = [event.type for event in events]
    assert "budget_exceeded" in types

    exceeded = next(event for event in events if event.type == "budget_exceeded")
    assert exceeded.budget["tool_id"] == "pricey.tool.v1"
    assert exceeded.budget["estimated"] == 50.0
    assert exceeded.budget["limit"] == 10

    # Nothing was spent; state is queryable.
    assert agent.budget_status() == {"limit": 10, "spent": 0.0, "remaining": 10}

    # The model still gets a tool result explaining the block.
    tool_result = next(
        event.tool_result for event in events if event.type == "tool_result" and event.tool_result["name"] == "call"
    )
    assert tool_result["is_error"] is True
    assert tool_result["result"]["error"] == "budget_exceeded"


@pytest.mark.asyncio
async def test_agent_executes_and_records_within_budget_call() -> None:
    agent, client, events = await _run_budget_agent(budget_credits=100)

    # Within budget: the call executed and spend was recorded.
    assert client.calls == ["discover", "call"]
    assert agent.budget_status() == {"limit": 100, "spent": 50.0, "remaining": 50.0}
    assert "budget_exceeded" not in [event.type for event in events]


@pytest.mark.asyncio
async def test_agent_without_budget_is_unchanged() -> None:
    agent, client, events = await _run_budget_agent(budget_credits=None)

    # No budget: default behavior, call executes, no budget events, no status.
    assert client.calls == ["discover", "call"]
    assert agent.budget_status() is None
    assert "budget_exceeded" not in [event.type for event in events]
    assert "budget_warning" not in [event.type for event in events]
