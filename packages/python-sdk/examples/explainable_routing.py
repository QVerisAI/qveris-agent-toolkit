"""Explainable capability routing.

Discover multiple candidate capabilities, compare them on the routing signals
QVeris returns (``why_recommended``, ``expected_cost``, and quality ``stats``),
then select one and explain the choice in plain language — the kind of
transparent, cost-aware decision an agent should make before spending credits.

For provider comparison, Inspect every candidate when current scope or a complete
contract must be confirmed; a Discover summary is not confirmation. Probe every
candidate when the comparison requires a current quote. Reuse may preserve an
exact route, never business parameters or results: build parameters from the
current request, and make a fresh Call for current, latest, today, or other
time-sensitive data.

Run:
    export QVERIS_API_KEY="sk-..."
    python explainable_routing.py
    # add RUN_QVERIS_CALLS=1 to also execute the chosen capability
"""

from __future__ import annotations

import asyncio
from typing import Optional

from _shared import require_api_key, should_call, supports_parameters

from qveris import QverisClient, ToolInfo


def parse_cost(value: object) -> Optional[float]:
    """expected_cost may be a string ("2.37"), a number, or absent."""
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def success_rate(tool: ToolInfo) -> Optional[float]:
    return tool.stats.success_rate if tool.stats else None


def latency_ms(tool: ToolInfo) -> Optional[float]:
    return tool.stats.avg_execution_time_ms if tool.stats else None


def choose(tools: list[ToolInfo]) -> tuple[ToolInfo, str]:
    """Pick a capability and return (tool, human-readable reason).

    The backend already ranks results by relevance and recent success, so the
    top result is the default choice. We layer two transparent, cost-aware
    overrides, scanning candidates in rank order:

    1. Cost saving — a much cheaper candidate (<=50% cost) that is no less
       reliable than the top result.
    2. Reliability upgrade — a candidate that costs no more than the top result
       but is meaningfully more reliable (>=5 points higher success rate).

    Both keep spend bounded: we never trade a large cost increase for
    reliability. Anything else falls back to the backend's top pick.
    """
    top = tools[0]
    top_cost = parse_cost(top.expected_cost)
    top_success = success_rate(top)

    for alt in tools[1:]:
        alt_cost = parse_cost(alt.expected_cost)
        alt_success = success_rate(alt)
        # Only override the backend ranking on evidence: skip any candidate
        # where cost or reliability is unknown rather than guess.
        if None in (top_cost, alt_cost, top_success, alt_success):
            continue
        if alt_cost <= top_cost * 0.5 and alt_success >= top_success - 0.02:
            return alt, (
                f"chose a cost-saving alternative — ~{alt_cost:g} vs ~{top_cost:g} credits "
                f"at comparable reliability ({_pct(alt_success)} vs {_pct(top_success)} success)."
            )
        if alt_cost <= top_cost and alt_success >= top_success + 0.05:
            return alt, (
                f"chose a more reliable capability at no extra cost — "
                f"{_pct(alt_success)} vs {_pct(top_success)} success for the same ~{alt_cost:g} credits."
            )

    reason = "chose the top-ranked capability"
    if top.why_recommended:
        reason += f": {top.why_recommended}"
    return top, reason


def _pct(value: Optional[float]) -> str:
    return f"{value * 100:.1f}%" if isinstance(value, (int, float)) else "n/a"


def _cost(value: object) -> str:
    parsed = parse_cost(value)
    return f"~{parsed:g} credits" if parsed is not None else "n/a"


def _latency(value: Optional[float]) -> str:
    return f"~{round(value)}ms" if isinstance(value, (int, float)) else "n/a"


async def main() -> None:
    if not require_api_key():
        return

    query = "public company stock quote and market data API"
    client = QverisClient()
    try:
        discovered = await client.discover(query, limit=5)
        if not discovered.results:
            print("No capabilities found.")
            return

        # This recipe compares providers, so Discover summaries are not enough:
        # inspect every candidate that participates in selection. Preserve only
        # why_recommended from Discover because that explanation is Discover-only;
        # contract, cost, and quality signals used below come from Inspect.
        inspected = await client.inspect(
            [tool.tool_id for tool in discovered.results],
            search_id=discovered.search_id,
        )
        inspected_by_id = {tool.tool_id: tool for tool in inspected.results}
        candidates = []
        for discovered_tool in discovered.results:
            tool = inspected_by_id.get(discovered_tool.tool_id)
            if tool is None:
                continue
            if discovered_tool.why_recommended:
                tool = tool.model_copy(update={"why_recommended": discovered_tool.why_recommended})
            candidates.append(tool)

        parameters = {"symbol": "AAPL"}
        compatible = [tool for tool in candidates if supports_parameters(tool, parameters)]
        if not compatible:
            raise RuntimeError("No candidate exposed a current contract compatible with the requested parameters")

        print(f'Query: "{query}"')
        print(f"Compatible candidates: {len(compatible)} (search_id={discovered.search_id})\n")

        for i, tool in enumerate(compatible, start=1):
            print(f"{i}. {tool.name or tool.tool_id}")
            print(f"   id:        {tool.tool_id}")
            print(f"   cost:      {_cost(tool.expected_cost)}")
            print(f"   success:   {_pct(success_rate(tool))}   latency: {_latency(latency_ms(tool))}")
            if tool.why_recommended:
                print(f"   why:       {tool.why_recommended}")
            print()

        selected, reason = choose(compatible)
        print(f"Selected: {selected.name or selected.tool_id}")
        print(f"Reason:   {reason}\n")

        if not should_call():
            print("Set RUN_QVERIS_CALLS=1 to execute the selected capability.")
            return

        result = await client.call(
            selected.tool_id,
            parameters,
            search_id=discovered.search_id,
            max_response_size=4096,
        )
        print(f"execution_id: {result.execution_id}")
        print(f"success:      {result.success}")
        print(f"billing:      {result.billing.summary if result.billing else None}")
        usage = await client.usage(execution_id=result.execution_id, summary=True, limit=5)
        print(f"usage_records: {usage.total}")
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
