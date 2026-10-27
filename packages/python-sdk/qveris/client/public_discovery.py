"""Frozen S5 public discovery contract; no executable or login authority."""

import json
import re
from http.cookiejar import DefaultCookiePolicy
from typing import Any, Dict, Iterable, List, Literal, Optional, Union

import httpx

from ..config import QverisConfig
from ..types import QverisModel, SearchStats, ToolInfo

_PUBLIC_CONTEXT = re.compile(r"pub_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


def is_public_context(value: object) -> bool:
    return isinstance(value, str) and value.startswith("pub_")


def validate_public_body(body: Dict[str, Any], operation: str) -> Dict[str, Any]:
    allowed = {"query", "limit", "view"} if operation == "discover" else {"tool_ids", "search_id", "view"}
    if set(body) - allowed:
        raise ValueError("Unsupported field in public read-only discovery")
    if "view" in body and body["view"] not in {"full", "routing"}:
        raise ValueError("Public discovery view must be full or routing")
    if operation == "discover":
        query = body.get("query")
        if not isinstance(query, str) or not 1 <= len(query.strip()) <= 1024:
            raise ValueError("Public discovery query must contain 1–1024 characters")
        body = {**body, "query": query.strip()}
        if "limit" in body and (type(body["limit"]) is not int or not 1 <= body["limit"] <= 20):
            raise ValueError("Public discovery limit must be an integer from 1 to 20")
    else:
        ids = body.get("tool_ids")
        if (
            not isinstance(ids, list)
            or not 1 <= len(ids) <= 10
            or any(not isinstance(value, str) or not 1 <= len(value) <= 255 or not value.isprintable() for value in ids)
            or len(set(ids)) != len(ids)
        ):
            raise ValueError("Public Inspect requires 1–10 unique printable tool IDs of at most 255 characters")
        if "search_id" in body and not _PUBLIC_CONTEXT.fullmatch(str(body["search_id"])):
            raise ValueError("Public Inspect requires a public discovery context")
    if len(json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()) > 8192:
        raise ValueError("Public discovery body exceeds 8192 bytes")
    return body


def validate_public_response(value: Any) -> None:
    if (
        not isinstance(value, dict)
        or not isinstance(value.get("search_id"), str)
        or not _PUBLIC_CONTEXT.fullmatch(value["search_id"])
        or not isinstance(value.get("results"), list)
        or not isinstance(value.get("contract_features"), list)
        or ("public-readonly-v1" not in value["contract_features"] or "remaining_credits" in value)
    ):
        raise ValueError("Endpoint did not return the public-readonly-v1 discovery contract")


class StatelessCookiePolicy(DefaultCookiePolicy):
    """Neither store response cookies nor return cookies on public requests."""

    def set_ok(self, cookie: Any, request: Any) -> bool:
        return False

    def return_ok(self, cookie: Any, request: Any) -> bool:
        return False


class PublicSearchResponse(QverisModel):
    """Catalog information only; missing price/balance never implies free use."""

    search_id: str
    contract_features: List[str]
    results: List[ToolInfo]
    error_message: Optional[str] = None
    contract_warnings: Optional[List[str]] = None
    query: Optional[str] = None
    total: Optional[int] = None
    stats: Optional[SearchStats] = None
    elapsed_time_ms: Optional[float] = None


class PublicDiscoveryClient:
    """Explicit credential-free Discover/Inspect. Authenticate with a new client.

    Re-inspect selected IDs and review current inputs and a fresh quote before
    explicitly calling through that authenticated client. Never reuse pub_ IDs.
    Use ``transport`` for injection; borrowed HTTP clients may retain identity.
    """

    def __init__(self, config: Optional[QverisConfig] = None, *, transport: Optional[httpx.AsyncBaseTransport] = None):
        from .api import QverisClient

        self._client = QverisClient(config=config, public_read_only=True, transport=transport)

    @staticmethod
    def _public_result(result: Any) -> PublicSearchResponse:
        response = PublicSearchResponse(**result.model_dump(exclude_unset=True))
        if result.request_metadata is not None:
            response._set_request_metadata(result.request_metadata)
        return response

    async def discover(
        self,
        query: str,
        limit: int = 10,
        *,
        view: Optional[Literal["routing", "full"]] = None,
        timeout: Optional[float] = None,
    ) -> PublicSearchResponse:
        return self._public_result(await self._client.discover(query, limit=limit, view=view, timeout=timeout))

    async def inspect(
        self,
        tool_ids: Union[Iterable[str], str],
        search_id: Optional[str] = None,
        *,
        view: Optional[Literal["routing", "full"]] = None,
        timeout: Optional[float] = None,
    ) -> PublicSearchResponse:
        return self._public_result(
            await self._client.inspect(tool_ids, search_id=search_id, view=view, timeout=timeout)
        )

    async def close(self) -> None:
        await self._client.close()

    async def __aenter__(self) -> "PublicDiscoveryClient":
        return self

    async def __aexit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> None:
        await self.close()
