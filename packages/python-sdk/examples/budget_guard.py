"""Cost-aware agent with a per-session credit budget.

`Agent(budget_credits=N)` bounds how many credits the loop may spend: it learns
`expected_cost` from discover/inspect, blocks a `call` projected to exceed the
budget *before* the request is sent (emitting a `budget_exceeded` event so the
model can pick a cheaper capability or stop), and warns as spend approaches the
limit. Without `budget_credits`, agent behavior is unchanged.

Run:
    python budget_guard.py                       # offline BudgetTracker demo
    # with keys set, also runs a real budgeted agent loop:
    export QVERIS_API_KEY="sk-..." OPENAI_API_KEY="sk-..."
    python budget_guard.py
"""

import asyncio
import os

from qveris import Agent, BudgetTracker, Message


def offline_demo() -> None:
    """Deterministic illustration of the guard — no network, no keys."""
    print("== BudgetTracker (offline) ==")
    budget = BudgetTracker(limit=10)
    # The agent normally feeds discover/inspect results in for you; here we do it by hand.
    budget.observe(
        {"results": [{"tool_id": "cheap.v1", "expected_cost": "1"}, {"tool_id": "pricey.v1", "expected_cost": "24.2"}]}
    )

    print(f"budget: {budget.snapshot()}")
    print(f"call cheap.v1 (est 1)?  blocked={budget.check('cheap.v1') is not None}")
    print(f"call pricey.v1 (est 24.2)?  blocked={budget.check('pricey.v1') is not None}")

    budget.record({"billing": {"list_amount_credits": 1}})  # actually spent 1 on cheap.v1
    print(f"after spending 1: {budget.snapshot()}\n")


async def agent_demo() -> None:
    if not os.getenv("QVERIS_API_KEY") or not os.getenv("OPENAI_API_KEY"):
        print("Set QVERIS_API_KEY and OPENAI_API_KEY to run the budgeted agent loop.")
        return

    print("== Budgeted agent loop ==")
    agent = Agent(budget_credits=25)
    try:
        messages = [Message(role="user", content="Find a stock quote capability and quote AAPL.")]
        async for event in agent.run(messages):
            if event.type == "content" and event.content:
                print(event.content, end="", flush=True)
            elif event.type == "tool_call" and event.tool_call:
                print(f"\n-> {event.tool_call.get('function', {}).get('name')}")
            elif event.type == "budget_warning":
                print(f"\n[budget] warning: {event.budget}")
            elif event.type == "budget_exceeded":
                print(f"\n[budget] blocked over-budget call: {event.budget}")
        print(f"\nfinal budget: {agent.budget_status()}")
    finally:
        await agent.close()


async def main() -> None:
    offline_demo()
    await agent_demo()


if __name__ == "__main__":
    asyncio.run(main())
