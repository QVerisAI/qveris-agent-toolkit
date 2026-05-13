"""Minimal agent loop integration using the built-in QVeris Agent."""

import asyncio
import os

from qveris import Agent, Message


async def main() -> None:
    if not os.getenv("QVERIS_API_KEY") or not os.getenv("OPENAI_API_KEY"):
        print("Set QVERIS_API_KEY and OPENAI_API_KEY to run the agent loop example.")
        return

    agent = Agent()
    try:
        messages = [
            Message(
                role="user",
                content="Find a capability for current weather, inspect it if needed, then explain what parameters it needs.",
            )
        ]

        async for event in agent.run(messages):
            if event.type == "content" and event.content:
                print(event.content, end="", flush=True)
            elif event.type == "tool_call" and event.tool_call:
                print(f"\n-> tool_call: {event.tool_call.get('function', {}).get('name')}")
            elif event.type == "tool_result" and event.tool_result:
                print("\n<- tool_result")
    finally:
        await agent.close()


if __name__ == "__main__":
    asyncio.run(main())
