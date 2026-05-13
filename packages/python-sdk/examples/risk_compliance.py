"""Risk and compliance screening workflow for sanctions or entity checks."""

import asyncio

from _shared import preview_capability


async def main() -> None:
    await preview_capability(
        "sanctions screening or adverse media compliance API",
        {"name": "Acme Trading Ltd"},
    )


if __name__ == "__main__":
    asyncio.run(main())
