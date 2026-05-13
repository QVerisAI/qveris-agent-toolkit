"""Data analysis workflow for enriching a dataset with a discovered capability."""

import asyncio

from _shared import preview_capability


async def main() -> None:
    await preview_capability(
        "company domain enrichment API",
        {"domain": "qveris.ai"},
    )


if __name__ == "__main__":
    asyncio.run(main())
