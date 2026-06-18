"""Search stage: run one expanded query against the web and return result
candidates. The default target is a frontier model's native web-search tool
(Variant A) — it fans out, reads full pages, and extracts results in one call.

`FrontierWebSearch` (the engine) and its `WebSearchBackend` port are the real,
dependency-free core; `OpenAIWebSearch` (the concrete backend, extra `llm`) is
re-exported lazily, so importing this door never pulls in the optional extra.
`from events_curator.search import OpenAIWebSearch` loads it on demand and raises
a clear ImportError if `llm` is not installed.

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
    UnconfiguredWebSearch,
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
    "UnconfiguredWebSearch",
    "WebSearchBackend",
    "WebSearchTuning",
    "canonicalize_url",
]


def __getattr__(name: str) -> object:
    if name == "OpenAIWebSearch":
        from events_curator.search.openai_native import OpenAIWebSearch  # noqa: PLC0415

        return OpenAIWebSearch
    raise AttributeError(f"module {__name__!r} has no attribute {name}")
