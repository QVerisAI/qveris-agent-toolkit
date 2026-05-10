"""
Async client for the Qveris API.

`QverisClient` is intentionally small and low-level: it provides direct wrappers around the
Qveris HTTP API plus a helper (`handle_tool_call`) that bridges LLM tool calls to Qveris calls.

Typical usage is indirect via `qveris.Agent`, but you can also use this client to integrate Qveris
into your own agent framework.

## Endpoints

- `POST /search` → `search_tools(...)`
- `POST /tools/execute?tool_id=...` → `execute_tool(...)`

## Authentication

If `QVERIS_API_KEY` is configured (via `QverisConfig.api_key`), it is sent as:

`Authorization: Bearer <token>`

Debug logs redact the token value.
"""

import json
from typing import Any, Callable, Dict, Optional, Tuple

import httpx

from ..config import QverisConfig
from ..types import SearchResponse, ToolExecutionResponse

class QverisClient:
    """
    Async client for Qveris API.
    """
    def __init__(self, config: Optional[QverisConfig] = None, debug_callback: Optional[Callable[[str], None]] = None):
        self.config = config or QverisConfig()
        self.debug_callback = debug_callback
        self.headers = {
            "Content-Type": "application/json",
        }
        if self.config.api_key:
            self.headers["Authorization"] = f"Bearer {self.config.api_key}"
            
        # httpx automatically respects HTTP_PROXY/HTTPS_PROXY env vars
        self.client = httpx.AsyncClient(
            base_url=self.config.base_url,
            headers=self.headers,
            timeout=60.0
        )
        
    def _debug(self, message: str):
        """Print debug message if callback is set"""
        if self.debug_callback:
            self.debug_callback(message)

    async def close(self):
        """
        Close the underlying HTTP client.

        Call this if you create `QverisClient` directly and want to free network resources.
        """
        await self.client.aclose()

    async def search_tools(self, query: str, limit: int = 100, session_id: Optional[str] = None) -> SearchResponse:
        """
        Search the Qveris tool index.

        Args:
            query: Natural-language description of the capability you want (not parameters).
                   Example: "weather forecast API" or "search recent news".
            limit: Maximum number of tools to return (server may cap this).
            session_id: Optional correlation id.

        Returns:
            `SearchResponse` containing `results` (tools) and `search_id` used for execution.
        """
        url = f"{self.config.base_url}/search"
        payload = {
            "query": query,
            "limit": limit,
        }

        if session_id:
            payload["session_id"] = session_id
        
        self._debug(f"[Qveris API] POST {url}")
        self._debug(f"[Qveris API] Request body: {json.dumps(payload, indent=2)}")
        self._debug(f"[Qveris API] Headers: {json.dumps({k: v if k != 'Authorization' else 'Bearer ***' for k, v in self.headers.items()}, indent=2)}")
        
        response = await self.client.post("/search", json=payload)
        
        self._debug(f"[Qveris API] Response status: {response.status_code}")
        try:
            response_json = response.json()
            self._debug(f"[Qveris API] Response body: {json.dumps(response_json, indent=2)}")
        except:
            self._debug(f"[Qveris API] Response body (raw): {response.text[:500]}")
        
        response.raise_for_status()
        return SearchResponse(**response.json())

    async def execute_tool(
        self, 
        tool_id: str, 
        parameters: Dict[str, Any],
        search_id: Optional[str] = None,
        session_id: Optional[str] = None,
        max_response_size: Optional[int] = None
    ) -> ToolExecutionResponse:
        """
        Execute a specific tool.

        Args:
            tool_id: Tool identifier returned by `search_tools(...)`.
            parameters: JSON-serializable parameters for the tool.
            search_id: Search id returned by `search_tools(...)` (recommended for traceability).
            session_id: Optional correlation id.
            max_response_size: Optional max response size in bytes. Large responses may be truncated.

        Returns:
            `ToolExecutionResponse` with `success`, `result`, and metadata.
        """
        url = f"{self.config.base_url}/tools/execute?tool_id={tool_id}"
        payload = {
            "parameters": parameters
        }
        
        if search_id:
            payload["search_id"] = search_id

        if session_id:
            payload["session_id"] = session_id

        if max_response_size:
            payload["max_response_size"] = max_response_size

        self._debug(f"[Qveris API] POST {url}")
        self._debug(f"[Qveris API] Request body: {json.dumps(payload, indent=2)}")
        self._debug(f"[Qveris API] Headers: {json.dumps({k: v if k != 'Authorization' else 'Bearer ***' for k, v in self.headers.items()}, indent=2)}")
        
        response = await self.client.post(
            "/tools/execute",
            params={"tool_id": tool_id},
            json=payload
        )
        
        self._debug(f"[Qveris API] Response status: {response.status_code}")
        try:
            response_json = response.json()
            self._debug(f"[Qveris API] Response body: {json.dumps(response_json, indent=2)}")
        except:
            self._debug(f"[Qveris API] Response body (raw): {response.text[:500]}")
        
        response.raise_for_status()
        return ToolExecutionResponse(**response.json())

    async def handle_tool_call(
        self,
        func_name: str,
        func_args: Dict[str, Any],
        session_id: Optional[str] = None
    ) -> Tuple[Any, bool, bool]:
        """
        Handle a built-in Qveris tool (search_tools, execute_tool) call from an LLM response.
        
        Args:
            func_name: The name of the function/tool to call
            func_args: The arguments parsed from the LLM response
            session_id: Optional session ID for tracking
        
        Returns:
            Tuple of (result, is_error, handled) where:
            - result: the tool output (None if not handled)
            - is_error: True if an error occurred
            - handled: True if this was a Qveris tool and was processed

        Notes:
            - For `execute_tool`, the OpenAI tool schema uses a JSON-string argument field
              (`params_to_tool`) which this method parses into a dict.
            - If `func_name` is not a Qveris built-in, `(None, False, False)` is returned so that
              callers can route to their own tool handlers.
        """
        try:
            if func_name == "search_tools":
                result = await self.search_tools(
                    query=func_args.get("query"),
                    limit=func_args.get("limit", 10),
                    session_id=session_id
                )
                return result.model_dump(), False, True
                
            elif func_name == "execute_tool":
                params_str = func_args.get("params_to_tool")
                try:
                    params = json.loads(params_str) if params_str else {}
                except (json.JSONDecodeError, TypeError):
                    params = {}
                    
                result = await self.execute_tool(
                    tool_id=func_args.get("tool_id"),
                    parameters=params,
                    search_id=func_args.get("search_id"),
                    session_id=session_id,
                    max_response_size=func_args.get("max_response_size")
                )
                return result.model_dump(), False, True
                
            else:
                # Not a Qveris tool
                return None, False, False
                
        except httpx.HTTPStatusError as e:
            return {"error": f"HTTP {e.response.status_code}: {e.response.text[:500]}"}, True, True
        except Exception as e:
            return {"error": str(e)}, True, True
