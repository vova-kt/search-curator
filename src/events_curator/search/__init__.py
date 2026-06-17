"""Search stage: run one expanded query against the web and return result
candidates. The default target is a frontier model's native web-search tool
(Variant A) — it fans out, reads full pages, and extracts results in one call.

Rule 5: the orchestrator dispatches all expanded queries concurrently; an engine
implements a single query here.
"""

from __future__ import annotations

from typing import Protocol

from events_curator.enums import SearchEngineKind
from events_curator.models import ExpandedQuery, RawSearchResult


class SearchEngine(Protocol):
    kind: SearchEngineKind

    async def search(self, query: ExpandedQuery) -> list[RawSearchResult]: ...


class FrontierWebSearch:
    """STUB for Variant A (an LLM's built-in web search). Wire a real adapter
    (extra `llm`) that fans out, reads pages, and extracts RawSearchResults."""

    kind = SearchEngineKind.FRONTIER_NATIVE

    async def search(self, query: ExpandedQuery) -> list[RawSearchResult]:
        del query
        raise NotImplementedError("FrontierWebSearch is a stub; wire a native web-search adapter.")


__all__ = ["FrontierWebSearch", "SearchEngine"]
