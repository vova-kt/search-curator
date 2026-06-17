"""Closed sets of runtime values, defined once and imported everywhere.

Project rule 4: never hard-code the underlying literals at call sites.
"""

from __future__ import annotations

from enum import StrEnum


class Stage(StrEnum):
    """The ordered stages of a single curation run."""

    EXPAND = "expand"
    SEARCH = "search"
    MERGE = "merge"
    DEDUP = "dedup"
    STORE = "store"
    RANK = "rank"


class FeedbackKind(StrEnum):
    LIKE = "like"
    DISLIKE = "dislike"


class DedupDecision(StrEnum):
    """Outcome of reconciling one candidate against the stored corpus."""

    AUTO_MERGE = "auto_merge"  # similarity >= auto-merge threshold
    TIEBREAK = "tiebreak"  # ambiguous band -> LLM judge decides
    INSERT_NEW = "insert_new"  # below the lower threshold


class SearchEngineKind(StrEnum):
    FRONTIER_NATIVE = "frontier_native"  # an LLM's built-in web-search tool (Variant A)
    EXA = "exa"
    LINKUP = "linkup"
    PERPLEXITY = "perplexity"
    SERPER = "serper"


class LLMProvider(StrEnum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"


class EmbedderKind(StrEnum):
    BGE_SMALL = "bge_small"  # local CPU-friendly default
    OPENAI = "openai"  # text-embedding-3-small via API


class AuthScheme(StrEnum):
    TELEGRAM = "telegram"  # authenticate by Telegram chat id
    API_TOKEN = "api_token"  # static bearer token
    LOCAL = "local"  # single-operator local dev (auto-trusts)


class RunMode(StrEnum):
    LIVE = "live"  # real network calls, real persistence
    EVAL = "eval"  # fixtures and golden comparisons, no side effects
