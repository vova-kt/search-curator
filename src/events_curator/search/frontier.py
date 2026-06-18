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

from events_curator.enums import ReasoningEffort, SearchContextSize, SearchEngineKind
from events_curator.models import ExpandedQuery, Geo, GeoBias, RawSearchResult

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

    url: str = Field(description="Absolute http(s) URL of the result's canonical page.")
    title: str = Field(description="Concise human-readable name of the result.")
    description: str = Field(default="", description="Short summary of the result, if available.")
    starts_at: datetime | None = Field(
        default=None, description="Start datetime in ISO 8601, or null if unknown."
    )
    ends_at: datetime | None = Field(
        default=None, description="End datetime in ISO 8601, or null if unknown."
    )
    city: str | None = Field(default=None, description="City, or null if unknown.")
    country: str | None = Field(default=None, description="Country, or null if unknown.")
    venue: str | None = Field(default=None, description="Venue or place name, or null if unknown.")
    image_url: str | None = Field(
        default=None, description="Absolute http(s) URL of a representative image, or null."
    )
    attributes: dict[str, str] = Field(
        default_factory=dict[str, str],
        description=(
            "Extra facts that matter for this kind of item but have no dedicated field, "
            "as a flat map of string key to string value — e.g. authors and journal for a "
            "paper, company and salary for a job, organizer for an event. Use lowercase "
            "snake_case keys; omit anything you cannot find."
        ),
    )
    price: str | None = Field(
        default=None, description="Price as shown (e.g. '15€', 'free'), or null if unknown."
    )


class ExtractedResults(BaseModel):
    """The batch a `WebSearchBackend` returns in one call. Its JSON schema defines
    the `submit_results` function tool the model calls, so extraction reads typed
    tool arguments instead of parsing free-form text."""

    results: list[ExtractedResult] = Field(default_factory=list[ExtractedResult])


class WebSearchTuning(BaseModel):
    """Provider-tuning for a native web-search call, resolved from `[search]` config
    by the builder and handed to the backend: how hard the model thinks, how much
    web context it pulls, and an optional domain allow-list. The geographic bias is
    *not* here — it's a per-user attribute (`User.location`) passed per call.
    Provider-agnostic in shape; the OpenAI backend maps it onto the Responses
    `web_search` tool and `reasoning.effort`."""

    search_context_size: SearchContextSize
    reasoning_effort: ReasoningEffort
    allowed_domains: list[str] = Field(default_factory=list[str])


class WebSearchBackend(Protocol):
    async def find(
        self, query: str, *, max_results: int, location: GeoBias
    ) -> list[ExtractedResult]: ...


class SearchEngine(Protocol):
    """One expanded query against the web, biased by the requesting user's location.
    The orchestrator fans out across queries concurrently (rule 5)."""

    kind: SearchEngineKind

    async def search(self, query: ExpandedQuery, *, location: GeoBias) -> list[RawSearchResult]: ...


class FrontierWebSearch(SearchEngine):
    """Drives a `WebSearchBackend` for one expanded query and shapes its rows into
    ranked `RawSearchResult`s. The orchestrator fans out across queries (rule 5),
    so this issues a single backend call per query."""

    kind = SearchEngineKind.FRONTIER_NATIVE

    def __init__(self, backend: WebSearchBackend, *, max_results: int = 20) -> None:
        self._backend = backend
        self._max_results = max_results

    async def search(self, query: ExpandedQuery, *, location: GeoBias) -> list[RawSearchResult]:
        extracted = await self._backend.find(
            query.text, max_results=self._max_results, location=location
        )
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
                    image_url=item.image_url,
                    attributes=dict(item.attributes),
                    price=item.price,
                    rank=len(results),
                )
            )
            if len(results) >= self._max_results:
                break
        return results


class UnconfiguredWebSearch(WebSearchBackend):
    """Default backend: raises until a real one (extra `llm`) is wired."""

    async def find(
        self, query: str, *, max_results: int, location: GeoBias
    ) -> list[ExtractedResult]:
        del query, max_results, location
        raise NotImplementedError(
            "No web-search backend; install the `llm` extra and wire OpenAIWebSearch."
        )
