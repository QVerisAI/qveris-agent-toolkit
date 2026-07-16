"""Use QVeris capabilities as LlamaIndex tools.

Adapter only:
    pip install "qveris[llamaindex]"

Complete FunctionAgent example:
    pip install "qveris[llamaindex]" llama-index-llms-openai
    export QVERIS_API_KEY="sk-..." OPENAI_API_KEY="sk-..."
    python llamaindex_integration.py

`get_qveris_tools(client)` returns three native LlamaIndex FunctionTools.
"""

import asyncio
import os

from qveris import QverisClient
from qveris.integrations.llamaindex import get_qveris_tools


async def main() -> None:
    client = QverisClient()
    try:
        tools = get_qveris_tools(client)
        print("QVeris LlamaIndex tools:", [tool.metadata.name for tool in tools])

        if not os.getenv("QVERIS_API_KEY") or not os.getenv("OPENAI_API_KEY"):
            print("Set QVERIS_API_KEY and OPENAI_API_KEY to run the agent.")
            return

        from llama_index.core.agent.workflow import FunctionAgent
        from llama_index.llms.openai import OpenAI

        agent = FunctionAgent(
            tools=tools,
            llm=OpenAI(model="gpt-4o-mini"),
            system_prompt="Use QVeris to discover, inspect, and call external capabilities.",
        )
        result = await agent.run(user_msg="Find a stock quote capability and quote AAPL.")
        print(result)
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
