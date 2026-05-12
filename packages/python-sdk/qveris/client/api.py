"""
Async client for the Qveris API.

`QverisClient` is intentionally small and low-level: it provides direct wrappers around the
Qveris HTTP API plus a helper (`handle_tool_call`) that bridges LLM tool calls to Qveris calls.

Typical usage is indirect via `qveris.Agent`, but you can also use this client to integrate Qveris
into your own agent framework.

## Endpoints

- `POST /search` → `discover(...)`
- `POST /tools/by-ids` → `inspect(...)`
- `POST /tools/execute?tool_id=...` → `call(...)`

## Authentication

If `QVERIS_API_KEY` is configured (via `QverisConfig.api_key`), it is sent as:

`Authorization: Bearer <token>`

Debug logs redact the token value.
"""

import json
from typing import Any, Callable, Dict, Iterable, Optional, Tuple

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
        self.base_url = self.config.base_url.rstrip("/") + "/"
        self.client = httpx.AsyncClient(
            base_url=self.base_url,
            headers=self.headers,
            timeout=60.0
        )

    def _debug(self, message: str):
        """Print debug message if callback is set"""
        if self.debug_callback:
            self.debug_callback(message)

    def _parse_response_json(self, response: httpx.Response) -> Any:
        """Parse response JSON once while still logging non-JSON bodies for debugging."""
        try:
            data = response.json()
            self._debug(f"[Qveris API] Response body: {json.dumps(data, indent=2)}")
            return data
        except json.JSONDecodeError:
            self._debug(f"[Qveris API] Response body (raw): {response.text[:500]}")
            response.raise_for_status()
            raise

    def _url_for(self, path: str, params: Optional[Dict[str, Any]] = None) -> str:
        """Build the effective request URL using the same httpx client settings."""
        return str(self.client.build_request("POST", path, params=params).url)

    async def close(self):
        """
        Close the underlying HTTP client.

        Call this if you create `QverisClient` directly and want to free network resources.
        """
        await self.client.aclose()

    async def discover(self, query: str, limit: int = 20, session_id: Optional[str] = None) -> SearchResponse:
        """
        Discover capabilities from the Qveris index.

        Args:
            query: Natural-language description of the capability you want (not parameters).
                   Example: "weather forecast API" or "search recent news".
            limit: Maximum number of tools to return (server may cap this).
            session_id: Optional correlation id.

        Returns:
            `SearchResponse` containing `results` (tools) and `search_id` used for execution.
        """
        url = self._url_for("search")
        payload = {
            "query": query,
            "limit": limit,
        }

        if session_id:
            payload["session_id"] = session_id

        self._debug(f"[Qveris API] POST {url}")
        self._debug(f"[Qveris API] Request body: {json.dumps(payload, indent=2)}")
        self._debug(f"[Qveris API] Headers: {json.dumps({k: v if k != 'Authorization' else 'Bearer ***' for k, v in self.headers.items()}, indent=2)}")

        response = await self.client.post("search", json=payload)

        self._debug(f"[Qveris API] Response status: {response.status_code}")
        data = self._parse_response_json(response)
        response.raise_for_status()
        return SearchResponse(**data)

    async def search_tools(self, query: str, limit: int = 20, session_id: Optional[str] = None) -> SearchResponse:
        """
        Deprecated alias for `discover(...)`.
        """
        return await self.discover(query=query, limit=limit, session_id=session_id)

    async def inspect(
        self,
        tool_ids: Iterable[str],
        search_id: Optional[str] = None,
        session_id: Optional[str] = None
    ) -> SearchResponse:
        """
        Inspect one or more capabilities by tool ID.

        Args:
            tool_ids: Tool IDs returned by `discover(...)`. A single string is accepted.
            search_id: Optional search ID that produced the tools.
            session_id: Optional correlation ID.

        Returns:
            `SearchResponse` with full tool details for the requested IDs.
        """
        ids = [tool_ids] if isinstance(tool_ids, str) else list(tool_ids or [])
        url = self._url_for("tools/by-ids")
        payload: Dict[str, Any] = {"tool_ids": ids}
        if search_id:
            payload["search_id"] = search_id
        if session_id:
            payload["session_id"] = session_id

        self._debug(f"[Qveris API] POST {url}")
        self._debug(f"[Qveris API] Request body: {json.dumps(payload, indent=2)}")
        self._debug(f"[Qveris API] Headers: {json.dumps({k: v if k != 'Authorization' else 'Bearer ***' for k, v in self.headers.items()}, indent=2)}")

        response = await self.client.post("tools/by-ids", json=payload)

        self._debug(f"[Qveris API] Response status: {response.status_code}")
        data = self._parse_response_json(response)
        response.raise_for_status()
        return SearchResponse(**data)

    async def get_tools_by_ids(
        self,
        tool_ids: Iterable[str],
        search_id: Optional[str] = None,
        session_id: Optional[str] = None
    ) -> SearchResponse:
        """Deprecated alias for `inspect(...)`."""
        return await self.inspect(tool_ids=tool_ids, search_id=search_id, session_id=session_id)

    async def call(
        self,
        tool_id: str,
        parameters: Dict[str, Any],
        search_id: Optional[str] = None,
        session_id: Optional[str] = None,
        max_response_size: Optional[int] = None
    ) -> ToolExecutionResponse:
        """
        Call a specific capability.

        Args:
            tool_id: Tool identifier returned by `discover(...)`.
            parameters: JSON-serializable parameters for the tool.
            search_id: Search id returned by `discover(...)` (recommended for traceability).
            session_id: Optional correlation id.
            max_response_size: Optional max response size in bytes. Large responses may be truncated.

        Returns:
            `ToolExecutionResponse` with `success`, `result`, and metadata.
        """
        url = self._url_for("tools/execute", params={"tool_id": tool_id})
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
            "tools/execute",
            params={"tool_id": tool_id},
            json=payload
        )

        self._debug(f"[Qveris API] Response status: {response.status_code}")
        data = self._parse_response_json(response)
        response.raise_for_status()
        return ToolExecutionResponse(**data)

    async def execute_tool(
        self,
        tool_id: str,
        parameters: Dict[str, Any],
        search_id: Optional[str] = None,
        session_id: Optional[str] = None,
        max_response_size: Optional[int] = None
    ) -> ToolExecutionResponse:
        """
        Deprecated alias for `call(...)`.
        """
        return await self.call(
            tool_id=tool_id,
            parameters=parameters,
            search_id=search_id,
            session_id=session_id,
            max_response_size=max_response_size,
        )

    async def handle_tool_call(
        self,
        func_name: str,
        func_args: Dict[str, Any],
        session_id: Optional[str] = None
    ) -> Tuple[Any, bool, bool]:
        """
        Handle a built-in Qveris tool (`discover`, `inspect`, `call`) from an LLM response.

        Deprecated names (`search_tools`, `get_tools_by_ids`, `execute_tool`) are accepted as aliases.

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
            - For `call`, `params_to_tool` may be a JSON string or a dict.
            - If `func_name` is not a Qveris built-in, `(None, False, False)` is returned so that
              callers can route to their own tool handlers.
        """
        try:
            if func_name in {"discover", "search_tools"}:
                result = await self.discover(
                    query=func_args.get("query"),
                    limit=func_args.get("limit", 20),
                    session_id=session_id
                )
                return result.model_dump(), False, True

            elif func_name in {"inspect", "get_tools_by_ids"}:
                result = await self.inspect(
                    tool_ids=func_args.get("tool_ids") or [],
                    search_id=func_args.get("search_id"),
                    session_id=session_id
                )
                return result.model_dump(), False, True

            elif func_name in {"call", "execute_tool"}:
                params_val = func_args.get("params_to_tool")
                if isinstance(params_val, str):
                    try:
                        params = json.loads(params_val) if params_val else {}
                    except (json.JSONDecodeError, TypeError):
                        params = {}
                else:
                    params = params_val if isinstance(params_val, dict) else {}

                result = await self.call(
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
