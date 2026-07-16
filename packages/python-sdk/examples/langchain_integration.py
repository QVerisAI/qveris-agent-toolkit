"""Use QVeris capabilities as LangChain tools.

    pip install "qveris[langchain]"
    export QVERIS_API_KEY="sk-..."
    python langchain_integration.py

`get_qveris_tools(client)` returns three async LangChain tools
(qveris_discover / qveris_inspect / qveris_call). Bind them to any
LangChain or LangGraph agent, e.g.:

    # A complete agent also needs `langchain` and a model-provider package.
    from langchain.agents import create_agent
    agent = create_agent(model, tools=get_qveris_tools(client))

This example invokes the discover tool directly (no LLM required) to show the
tools work end to end.
"""

import asyncio
import json
import os

from qveris import QverisClient
from qveris.integrations.langchain import get_qveris_tools


async def main() -> None:
    client = QverisClient()
    try:
        tools = get_qveris_tools(client)
        print("QVeris LangChain tools:", [t.name for t in tools])

        if not os.getenv("QVERIS_API_KEY"):
            print("Set QVERIS_API_KEY to invoke the tools.")
            return

        discover = next(t for t in tools if t.name == "qveris_discover")
        result = json.loads(await discover.ainvoke({"query": "stock price market data API", "limit": 3}))
        print(f"search_id: {result.get('search_id')}")
        for r in (result.get("results") or [])[:3]:
            print(f" - {r.get('tool_id')} | {(r.get('why_recommended') or '')[:60]}")
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
