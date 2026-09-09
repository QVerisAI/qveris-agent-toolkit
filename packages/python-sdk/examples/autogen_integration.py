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
            system_message=(
                "Use QVeris when capability discovery, comparison, or fallback is needed. "
                "Discover then call when the contract is sufficient; inspect only for missing or stale contract details. "
                "Provider comparison: Inspect each candidate to confirm current scope/contracts. If a budget decision "
                "requires a current Probe cost quote, do not Call until the host obtains it; this three-tool adapter "
                "does not expose Probe. This does not apply to fresh business data such as a stock quote; obtain that "
                "with Call. "
                "Reuse only exact routes; rebuild current parameters and Call again for current/latest/today/time-sensitive data."
            ),
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
