"""
You.com Web Search via QVeris - Python SDK Example

This script demonstrates how to use You.com web search capabilities 
through the QVeris capability routing network.
"""

import asyncio
import os
import json
from typing import Optional, List, Dict, Any
from qveris import QverisClient


class YouComSearchClient:
    """Wrapper for You.com web search via QVeris."""
    
    def __init__(self, api_key: Optional[str] = None):
        """Initialize QVeris client with API key."""
        self.api_key = api_key or os.getenv('QVERIS_API_KEY')
        if not self.api_key:
            raise ValueError(
                "QVERIS_API_KEY environment variable or api_key parameter required. "
                "Get your key at: https://qveris.ai/account?page=api-keys"
            )
        self.client = QverisClient(api_key=self.api_key)
        self._search_id = None
        self._web_search_tools = []

    async def discover_search_capabilities(self) -> List[Dict[str, Any]]:
        """Discover available web search capabilities."""
        print("🔍 Discovering web search capabilities...")
        
        discovered = await self.client.discover("web search API", limit=15)
        self._search_id = discovered.search_id
        self._web_search_tools = discovered.results
        
        print(f"Found {len(self._web_search_tools)} web search capabilities:")
        for i, tool in enumerate(self._web_search_tools):
            provider = tool.provider or "Unknown"
            print(f"  {i+1}. {tool.name} by {provider}")
        
        return self._web_search_tools

    def find_youcom_capability(self) -> Optional[Dict[str, Any]]:
        """Find You.com-specific search capability if available."""
        for tool in self._web_search_tools:
            if "you.com" in (tool.provider or "").lower():
                return tool
        return None

    async def inspect_capability(self, tool_id: str) -> Dict[str, Any]:
        """Inspect a specific search capability."""
        inspected = await self.client.inspect(tool_id, search_id=self._search_id)
        return inspected.results[0] if inspected.results else None

    async def search(
        self, 
        query: str, 
        count: int = 5, 
        prefer_youcom: bool = True
    ) -> Dict[str, Any]:
        """Execute web search with specified query."""
        if not self._web_search_tools:
            await self.discover_search_capabilities()
        
        # Select search tool
        selected_tool = None
        if prefer_youcom:
            selected_tool = self.find_youcom_capability()
        
        if not selected_tool:
            selected_tool = self._web_search_tools[0]
        
        provider = selected_tool.provider or "Unknown"
        print(f"🌐 Searching with: {selected_tool.name} by {provider}")
        print(f"Query: \"{query}\"")
        
        # Execute search
        result = await self.client.call(
            selected_tool.tool_id,
            {"query": query, "count": count},
            search_id=self._search_id
        )
        
        return {
            'execution_id': result.execution_id,
            'tool_used': {
                'name': selected_tool.name,
                'provider': provider,
                'id': selected_tool.tool_id
            },
            'results': result.result
        }

    async def get_usage_stats(self, execution_id: Optional[str] = None) -> Dict[str, Any]:
        """Get usage statistics and billing info."""
        if execution_id:
            usage = await self.client.usage(execution_id=execution_id, summary=True)
        else:
            usage = await self.client.usage(summary=True)
        return usage.model_dump()

    async def close(self):
        """Close the QVeris client."""
        await self.client.close()


async def demo_searches():
    """Demonstrate various search scenarios."""
    search_client = YouComSearchClient()
    
    try:
        # Discover capabilities
        await search_client.discover_search_capabilities()
        
        # Example searches
        search_queries = [
            {
                "query": "latest AI breakthroughs 2026",
                "count": 5,
                "description": "Current AI research developments"
            },
            {
                "query": "Python asyncio best practices",
                "count": 3,
                "description": "Technical documentation search"
            },
            {
                "query": "climate change news this week",
                "count": 4,
                "description": "Recent news and current events"
            }
        ]
        
        execution_ids = []
        
        for search_config in search_queries:
            print(f"\n{'='*60}")
            print(f"Search: {search_config['description']}")
            print(f"{'='*60}")
            
            result = await search_client.search(
                search_config["query"], 
                count=search_config["count"]
            )
            
            execution_ids.append(result['execution_id'])
            
            # Display results
            print(f"\nResults from {result['tool_used']['name']}:")
            if 'results' in result['results']:
                for i, item in enumerate(result['results']['results'][:3], 1):
                    title = item.get('title', 'No title')
                    url = item.get('url') or item.get('link', 'No URL')
                    snippet = item.get('snippet', '')[:100]
                    print(f"  {i}. {title}")
                    print(f"     {url}")
                    if snippet:
                        print(f"     {snippet}...")
                    print()
            
            # Small delay between searches
            await asyncio.sleep(1)
        
        # Show usage summary
        print(f"\n{'='*60}")
        print("Usage Summary")
        print(f"{'='*60}")
        
        usage_stats = await search_client.get_usage_stats()
        print(f"Total searches executed: {len(execution_ids)}")
        print(f"Usage details: {json.dumps(usage_stats, indent=2)}")
        
    except Exception as e:
        print(f"Error: {e}")
        return 1
    
    finally:
        await search_client.close()
    
    return 0


async def single_search_example(query: str = "latest developments in quantum computing"):
    """Simple single search example."""
    search_client = YouComSearchClient()
    
    try:
        print(f"Searching for: {query}")
        
        result = await search_client.search(query, count=5)
        
        print(f"\nResults from {result['tool_used']['provider']}:")
        print(json.dumps(result['results'], indent=2))
        
        # Check usage for this specific search
        usage = await search_client.get_usage_stats(result['execution_id'])
        print(f"\nUsage: {json.dumps(usage, indent=2)}")
        
    finally:
        await search_client.close()


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        # Single search with provided query
        query = " ".join(sys.argv[1:])
        exit_code = asyncio.run(single_search_example(query))
    else:
        # Run full demo
        exit_code = asyncio.run(demo_searches())
    
    sys.exit(exit_code)