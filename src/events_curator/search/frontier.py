"""Variant A search: a frontier model's native web-search tool.

`WebSearchBackend` is the narrow port the engine drives — "find structured rows
for one query". `FrontierWebSearch` is the engine: it turns those rows into
ranked `RawSearchResult`s, canonicalizing each URL at ingestion (the point the
corpus first sees it) so dedup downstream compares like with like. The default
backend, `UnconfiguredWebSearch`, raises until the `llm` extra is wired — same
shape as storage's optional SQLite adapter.

This module is dependency-free; the OpenAI-backed adapter lives in
`openai_native.py` behind the module door's lazy re-export.
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import BaseModel, Field

from events_curator.enums import SearchEngineKind
from events_curator.models import ExpandedQuery, Geo, RawSearchResult

# Query params that identify a click, not the resource. Dropped so the same item
# linked from two campaigns canonicalizes to one URL.
_TRACKING_PREFIXES = ("utm_",)
_TRACKING_KEYS = frozenset({"fbclid", "gclid", "mc_eid", "mc_cid", "igshid", "ref", "ref_src"})
_DEFAULT_PORTS = {"http": 80, "https": 443}


def canonicalize_url(url: str) -> str:
    """Collapse cosmetic URL variants to one key: lowercase scheme/host, drop a
    leading ``www.``, default ports, the fragment, and tracking params, and trim a
    trailing slash. Non-http(s) or scheme-less inputs are returned stripped but
    otherwise untouched (nothing safe to normalize); blank input returns ``""``."""
    url = url.strip()
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    if scheme not in _DEFAULT_PORTS or not parts.hostname:
        return url
    host = parts.hostname.removeprefix("www.")
    netloc = host
    if parts.port is not None and parts.port != _DEFAULT_PORTS[scheme]:
        netloc = f"{host}:{parts.port}"
    kept = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if not key.lower().startswith(_TRACKING_PREFIXES) and key.lower() not in _TRACKING_KEYS
    ]
    path = parts.path.rstrip("/") if len(parts.path) > 1 else parts.path
    return urlunsplit((scheme, netloc, path, urlencode(kept), ""))


class ExtractedResult(BaseModel):
    """One result the model extracted from the pages it read — the structured
    payload a `WebSearchBackend` returns, before engine bookkeeping (ids, source,
    rank) is attached."""

    url: str
    title: str
    description: str = ""
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    city: str | None = None
    country: str | None = None
    venue: str | None = None
    tags: list[str] = Field(default_factory=list[str])
    price: str | None = None


class WebSearchBackend(Protocol):
    async def find(self, query: str, *, max_results: int) -> list[ExtractedResult]: ...


class FrontierWebSearch:
    """Drives a `WebSearchBackend` for one expanded query and shapes its rows into
    ranked `RawSearchResult`s. The orchestrator fans out across queries (rule 5),
    so this issues a single backend call per query."""

    kind = SearchEngineKind.FRONTIER_NATIVE

    def __init__(self, backend: WebSearchBackend, *, max_results: int = 20) -> None:
        self._backend = backend
        self._max_results = max_results

    async def search(self, query: ExpandedQuery) -> list[RawSearchResult]:
        extracted = await self._backend.find(query.text, max_results=self._max_results)
        results: list[RawSearchResult] = []
        for item in extracted:
            url = canonicalize_url(item.url)
            if not url:
                continue
            results.append(
                RawSearchResult(
                    source_query_id=query.id,
                    source_engine=self.kind,
                    url=url,
                    title=item.title,
                    description=item.description,
                    starts_at=item.starts_at,
                    ends_at=item.ends_at,
                    geo=Geo(city=item.city, country=item.country, venue=item.venue),
                    tags=item.tags,
                    price=item.price,
                    rank=len(results),
                )
            )
            if len(results) >= self._max_results:
                break
        return results


class UnconfiguredWebSearch(WebSearchBackend):
    """Default backend: raises until a real one (extra `llm`) is wired."""

    async def find(self, query: str, *, max_results: int) -> list[ExtractedResult]:
        del query, max_results
        raise NotImplementedError(
            "No web-search backend; install the `llm` extra and wire OpenAIWebSearch."
        )
