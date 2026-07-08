"""Use QVeris capabilities as CrewAI tools.

    pip install qveris[crewai]
    export QVERIS_API_KEY="sk-..." OPENAI_API_KEY="sk-..."
    python crewai_integration.py

`get_qveris_tools(client)` returns three CrewAI tools
(qveris_discover / qveris_inspect / qveris_call) for a CrewAI Agent.
"""

import asyncio
import os

from qveris import QverisClient
from qveris.integrations.crewai import get_qveris_tools


async def main() -> None:
    client = QverisClient()
    try:
        tools = get_qveris_tools(client)
        print("QVeris CrewAI tools:", [t.name for t in tools])

        if not os.getenv("QVERIS_API_KEY") or not os.getenv("OPENAI_API_KEY"):
            print("Set QVERIS_API_KEY and OPENAI_API_KEY to run the crew.")
            return

        from crewai import Agent, Crew, Task

        researcher = Agent(
            role="Market Researcher",
            goal="Find and call the right external capability to answer the task.",
            backstory="You use QVeris to discover, inspect, and call capabilities.",
            tools=tools,
        )
        task = Task(
            description="Find a stock quote capability and quote AAPL.",
            expected_output="The current AAPL quote.",
            agent=researcher,
        )
        result = Crew(agents=[researcher], tasks=[task]).kickoff()
        print(result)
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
