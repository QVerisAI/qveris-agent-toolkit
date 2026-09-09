"""Use QVeris capabilities as CrewAI tools.

    pip install "qveris[crewai]"
    export QVERIS_API_KEY="sk-..." OPENAI_API_KEY="sk-..."
    python crewai_integration.py

`get_qveris_tools(client)` returns three CrewAI tools
(qveris_discover / qveris_inspect / qveris_call). CrewAI runs synchronously; the
tools bridge to the async client on a dedicated loop, so close the client with
`aclose(client)` (not `await client.close()`).
"""

import os

from qveris import QverisClient
from qveris.integrations.crewai import aclose, get_qveris_tools


def main() -> None:
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
            backstory=(
                "You use QVeris when capability discovery, comparison, or fallback is needed, "
                "and inspect only when the current contract lacks required details. "
                "Provider comparison: Inspect each candidate to confirm current scope/contracts. If current quotes are "
                "required, do not Call until the host obtains them; this three-tool adapter does not expose Probe. "
                "Reuse only exact routes; rebuild current parameters and Call again for current/latest/today/time-sensitive data."
            ),
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
        aclose(client)


if __name__ == "__main__":
    main()
