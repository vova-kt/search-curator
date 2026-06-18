"""Search stage: run one expanded query against the web and return result
candidates.

Rule 5: the orchestrator dispatches all expanded queries concurrently; an engine
implements a single query here.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from events_curator.search.frontier import (
    ExtractedResult,
    FrontierWebSearch,
    GeoBias,
    SearchEngine,
    WebSearchBackend,
    WebSearchTuning,
    canonicalize_url,
)

if TYPE_CHECKING:
    from events_curator.search.openai_native import OpenAIWebSearch


__all__ = [
    "ExtractedResult",
    "FrontierWebSearch",
    "GeoBias",
    "OpenAIWebSearch",
    "SearchEngine",
    "WebSearchBackend",
    "WebSearchTuning",
    "canonicalize_url",
]


def __getattr__(name: str) -> object:
    if name == "OpenAIWebSearch":
        from events_curator.search.openai_native import OpenAIWebSearch  # noqa: PLC0415

        return OpenAIWebSearch
    raise AttributeError(f"module {__name__!r} has no attribute {name}")
