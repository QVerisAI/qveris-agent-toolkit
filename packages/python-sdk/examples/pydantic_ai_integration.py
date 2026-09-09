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
            system_prompt=(
                "Use QVeris when capability discovery, comparison, or fallback is needed. "
                "Discover then call when the contract is sufficient; inspect only for missing or stale contract details. "
                "Provider comparison: Inspect each candidate to confirm current scope/contracts. If a budget decision "
                "requires a current Probe cost quote, do not Call until the host obtains it; this three-tool adapter "
                "does not expose Probe. This does not apply to fresh business data such as a stock quote; obtain that "
                "with Call. "
                "Reuse only exact routes; rebuild current parameters and Call again for current/latest/today/time-sensitive data."
            ),
        )
        result = await agent.run("Find a stock quote capability and quote AAPL.")
        print(result.output)
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
