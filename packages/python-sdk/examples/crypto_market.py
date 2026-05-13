"""Crypto market data workflow for token prices and exchange metrics."""

import asyncio

from _shared import preview_capability


async def main() -> None:
    await preview_capability(
        "cryptocurrency market price and volume API",
        {"symbol": "BTC", "currency": "USD"},
    )


if __name__ == "__main__":
    asyncio.run(main())
