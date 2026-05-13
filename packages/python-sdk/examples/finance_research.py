"""Finance research workflow using discover, inspect, call, usage, and ledger."""

import asyncio

from _shared import preview_capability


async def main() -> None:
    await preview_capability(
        "public company stock quote and market data API",
        {"symbol": "AAPL"},
    )


if __name__ == "__main__":
    asyncio.run(main())
