"""Use QVeris capabilities as AutoGen tools.

Adapter only:
    pip install "qveris[autogen]"

Complete AgentChat example:
    pip install "qveris[autogen]" autogen-agentchat "autogen-ext[openai]"
    export QVERIS_API_KEY="sk-..." OPENAI_API_KEY="sk-..."
    python autogen_integration.py

`get_qveris_tools(client)` returns three native AutoGen FunctionTools.
"""

import asyncio
import os

from qveris import QverisClient
from qveris.integrations.autogen import get_qveris_tools


async def main() -> None:
    client = QverisClient()
    model_client = None
    try:
        tools = get_qveris_tools(client)
        print("QVeris AutoGen tools:", [tool.name for tool in tools])

        if not os.getenv("QVERIS_API_KEY") or not os.getenv("OPENAI_API_KEY"):
            print("Set QVERIS_API_KEY and OPENAI_API_KEY to run the agent.")
            return

        from autogen_agentchat.agents import AssistantAgent
        from autogen_ext.models.openai import OpenAIChatCompletionClient

        model_client = OpenAIChatCompletionClient(model="gpt-4o-mini")
        agent = AssistantAgent(
            "qveris_assistant",
            model_client=model_client,
            tools=tools,
            system_message="Use QVeris to discover, inspect, and call external capabilities.",
            reflect_on_tool_use=True,
        )
        result = await agent.run(task="Find a stock quote capability and quote AAPL.")
        print(result.messages[-1].content)
    finally:
        if model_client is not None:
            await model_client.close()
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
