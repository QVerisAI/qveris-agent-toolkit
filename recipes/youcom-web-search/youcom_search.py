"""
You.com Web Search via QVeris - Python SDK Example

This script demonstrates how to use You.com web search capabilities
through the QVeris capability routing network.

The recipe fails closed: it only executes searches on a capability whose
provider is You.com. If You.com is not registered with QVeris yet, the
script exits before making any paid call.
"""

import asyncio
import os
import json
import sys
from typing import Any, Dict, List, Optional

from qveris import QverisClient
from qveris.config import QverisConfig


# Canonical You.com provider identities, compared after normalization
# (lowercase, non-alphanumerics stripped). Compared for equality, never
# as substrings, so unrelated providers like "YouCommerce" or "NotYou.com"
# cannot match.
_YOU_COM_PROVIDER_IDS = frozenset({"youcom", "youdotcom"})


def _normalize_provider_name(provider_name: str) -> str:
    """Lowercase and strip everything but [a-z0-9] from a provider name."""
    return "".join(ch for ch in provider_name.lower() if ch.isalnum())


def is_youcom_provider(provider_name: Optional[str]) -> bool:
    """Match You.com provider names returned by discovery.

    Exact equality against the canonical identities above, so
    "You.com", "YouCom", and "you com" all normalize to "youcom" and
    match, while "YouTube", "YouCommerce", or "NotYou.com" do not.
    """
    if not provider_name:
        return False
    return _normalize_provider_name(provider_name) in _YOU_COM_PROVIDER_IDS


class YouComSearchClient:
    """Wrapper for You.com web search via QVeris."""

    def __init__(self, api_key: Optional[str] = None):
        """Initialize QVeris client with API key."""
        api_key = api_key or os.getenv("QVERIS_API_KEY")
        if not api_key:
            raise ValueError(
                "QVERIS_API_KEY environment variable or api_key parameter required. "
                "Get your key at: https://qveris.ai/account?page=api-keys"
            )
        # The SDK client takes a QverisConfig positional argument.
        self.client = QverisClient(QverisConfig(api_key=api_key))
        self._search_id: Optional[str] = None
        self._web_search_tools: List[Any] = []

    async def discover_youcom_capability(self):
        """Discover capabilities and select the You.com one, if registered.

        Returns the selected ToolInfo, or None when no You.com capability is
        available. No paid call is made from here.
        """
        print("🔍 Discovering You.com web search capabilities...")

        discovered = await self.client.discover("You.com web search API", limit=15)
        self._search_id = discovered.search_id
        self._web_search_tools = discovered.results

        print(f"Found {len(self._web_search_tools)} candidate capabilities:")
        for i, tool in enumerate(self._web_search_tools):
            provider = tool.provider_name or "Unknown"
            marker = "  ← You.com" if is_youcom_provider(tool.provider_name) else ""
            print(f"  {i + 1}. {tool.name} by {provider}{marker}")

        selected = self.find_youcom_capability()
        if selected is None:
            print(
                "\nNo You.com capability is currently registered with QVeris. "
                "See the recipe README for the provider onboarding steps."
            )
        return selected

    def find_youcom_capability(self):
        """Find the You.com capability among discovered tools, if any."""
        for tool in self._web_search_tools:
            if is_youcom_provider(tool.provider_name):
                return tool
        return None

    async def inspect_capability(self, tool) -> Dict[str, Any]:
        """Inspect a capability and return its parameter schema as a dict.

        The SDK models inspect results as ToolInfo (an object, not a dict),
        so convert via model_dump() before dictionary access.
        """
        inspected = await self.client.inspect(tool.tool_id, search_id=self._search_id)
        if not inspected.results:
            return {}
        info = inspected.results[0]
        if hasattr(info, "model_dump"):
            return info.model_dump()
        return dict(info)

    async def search(self, query: str, count: int = 5) -> Dict[str, Any]:
        """Execute a You.com web search via QVeris.

        Fails closed: refuses to run on a non-You.com capability.
        """
        selected_tool = await self.discover_youcom_capability()
        if selected_tool is None:
            raise RuntimeError(
                "You.com is not available through QVeris yet; refusing to "
                "route this search to another provider."
            )

        provider = selected_tool.provider_name or "Unknown"
        print(f"🌐 Searching with: {selected_tool.name} by {provider}")
        print(f'Query: "{query}"')

        # Build parameters from the capability's declared schema so we only
        # send fields this tool actually accepts.
        inspected = await self.inspect_capability(selected_tool)
        params = self._build_params(inspected, query, count)

        result = await self.client.call(
            selected_tool.tool_id,
            params,
            search_id=self._search_id,
        )

        return {
            "execution_id": result.execution_id,
            "tool_used": {
                "name": selected_tool.name,
                "provider": provider,
                "id": selected_tool.tool_id,
            },
            "results": result.result,
        }

    @staticmethod
    def _build_params(inspected: Dict[str, Any], query: str, count: int) -> Dict[str, Any]:
        """Map query/count onto the parameter names the capability declares."""
        declared = [
            (p.get("name") if isinstance(p, dict) else getattr(p, "name", None))
            for p in (inspected.get("params") or [])
        ]
        params: Dict[str, Any] = {}
        if not declared:
            # No schema available; send the minimal common shape.
            return {"query": query, "count": count}
        if "q" in declared and "query" not in declared:
            params["q"] = query
        else:
            params["query"] = query
        if "count" in declared:
            params["count"] = count
        return params

    async def get_usage_stats(self, execution_id: Optional[str] = None) -> Dict[str, Any]:
        """Get usage summary. Returns the raw summary object from the SDK."""
        if execution_id:
            usage = await self.client.usage(execution_id=execution_id, summary=True)
        else:
            usage = await self.client.usage(summary=True)
        return usage.model_dump()

    async def close(self):
        """Close the QVeris client."""
        await self.client.close()


async def demo_searches() -> int:
    """Demonstrate a single You.com search scenario (fail-closed)."""
    search_client = YouComSearchClient()

    try:
        result = await search_client.search("latest AI breakthroughs 2026", count=5)

        print(f"\nResults from {result['tool_used']['name']}:")
        payload = result["results"]
        if isinstance(payload, dict) and isinstance(payload.get("results"), list):
            for i, item in enumerate(payload["results"][:3], 1):
                title = item.get("title", "No title")
                url = item.get("url") or item.get("link", "No URL")
                snippet = (item.get("snippet") or "")[:100]
                print(f"  {i}. {title}")
                print(f"     {url}")
                if snippet:
                    print(f"     {snippet}...")
                print()

        usage = await search_client.get_usage_stats(result["execution_id"])
        summary = usage.get("summary") or {}
        total_events = summary.get("total_events")
        credits = summary.get("actual_amount_credits")
        if total_events is not None or credits is not None:
            print(f"Total events: {total_events}, Credits used: {credits}")

        return 0

    except RuntimeError as e:
        # Expected outcome while You.com is not onboarded with QVeris.
        print(f"Not executed: {e}")
        return 0

    except Exception as e:
        print(f"Error: {e}")
        return 1

    finally:
        await search_client.close()


async def single_search_example(query: str = "latest developments in quantum computing") -> int:
    """Simple single search example (fail-closed to You.com)."""
    search_client = YouComSearchClient()

    try:
        result = await search_client.search(query, count=5)
        print(f"\nResults from {result['tool_used']['provider']}:")
        print(json.dumps(result["results"], indent=2))
        return 0

    except RuntimeError as e:
        print(f"Not executed: {e}")
        return 0

    except Exception as e:
        print(f"Error: {e}")
        return 1

    finally:
        await search_client.close()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        exit_code = asyncio.run(single_search_example(" ".join(sys.argv[1:])))
    else:
        exit_code = asyncio.run(demo_searches())

    sys.exit(exit_code)
