"""Use QVeris capabilities as Pydantic AI tools.

Adapter only:
    pip install "qveris[pydantic-ai]"

Complete agent example:
    pip install "qveris[pydantic-ai]" "pydantic-ai-slim[openai]"
    export QVERIS_API_KEY="sk-..." OPENAI_API_KEY="sk-..."
    python pydantic_ai_integration.py

`get_qveris_tools(client)` returns three native Pydantic AI Tool objects.
"""

import asyncio
import os

from qveris import QverisClient
from qveris.integrations.pydantic_ai import get_qveris_tools


async def main() -> None:
    client = QverisClient()
    try:
        tools = get_qveris_tools(client)
        print("QVeris Pydantic AI tools:", [tool.name for tool in tools])

        if not os.getenv("QVERIS_API_KEY") or not os.getenv("OPENAI_API_KEY"):
            print("Set QVERIS_API_KEY and OPENAI_API_KEY to run the agent.")
            return

        from pydantic_ai import Agent

        agent = Agent(
            "openai:gpt-4o-mini",
            tools=tools,
            system_prompt="Use QVeris to discover, inspect, and call external capabilities.",
        )
        result = await agent.run("Find a stock quote capability and quote AAPL.")
        print(result.output)
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
