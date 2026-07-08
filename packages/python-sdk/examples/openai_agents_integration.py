"""Use QVeris capabilities as OpenAI Agents SDK tools.

    pip install qveris[openai-agents]
    export QVERIS_API_KEY="sk-..." OPENAI_API_KEY="sk-..."
    python openai_agents_integration.py

`get_qveris_tools(client)` returns three FunctionTools
(qveris_discover / qveris_inspect / qveris_call) for an `agents.Agent`.
"""

import asyncio
import os

from qveris import QverisClient
from qveris.integrations.openai_agents import get_qveris_tools


async def main() -> None:
    client = QverisClient()
    try:
        tools = get_qveris_tools(client)
        print("QVeris OpenAI Agents tools:", [t.name for t in tools])

        if not os.getenv("QVERIS_API_KEY") or not os.getenv("OPENAI_API_KEY"):
            print("Set QVERIS_API_KEY and OPENAI_API_KEY to run the agent.")
            return

        from agents import Agent, Runner

        agent = Agent(
            name="QVeris Assistant",
            instructions="Use the QVeris tools to discover, inspect, and call external capabilities.",
            tools=tools,
        )
        result = await Runner.run(agent, "Find a stock quote capability and quote AAPL.")
        print(result.final_output)
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
