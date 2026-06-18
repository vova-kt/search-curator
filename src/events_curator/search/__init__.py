"""Search stage: run one expanded query against the web and return result
candidates.

Rule 5: the orchestrator dispatches all expanded queries concurrently; an engine
implements a single query here.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from events_curator.search._classify import DomainClassifier, LLMDomainClassifier
from events_curator.search.attributes import (
    DOMAIN_ATTRIBUTES,
    FALLBACK_DOMAIN,
    AttributeSpec,
    DomainSpec,
    domain_descriptions,
    emojis_for,
    instructions_for,
)
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
    "DOMAIN_ATTRIBUTES",
    "FALLBACK_DOMAIN",
    "AttributeSpec",
    "DomainClassifier",
    "DomainSpec",
    "ExtractedResult",
    "FrontierWebSearch",
    "GeoBias",
    "LLMDomainClassifier",
    "OpenAIWebSearch",
    "SearchEngine",
    "WebSearchBackend",
    "WebSearchTuning",
    "canonicalize_url",
    "domain_descriptions",
    "emojis_for",
    "instructions_for",
]


def __getattr__(name: str) -> object:
    if name == "OpenAIWebSearch":
        from events_curator.search.openai_native import OpenAIWebSearch  # noqa: PLC0415

        return OpenAIWebSearch
    raise AttributeError(f"module {__name__!r} has no attribute {name}")
