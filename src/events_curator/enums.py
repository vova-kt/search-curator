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


class ProgressPhase(StrEnum):
    """Where a stage is in its work, for the observable progress stream: a `START`
    announces slow work about to begin, a `DONE` reports its result."""

    START = "start"
    DONE = "done"


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


class SearchContextSize(StrEnum):
    """How much web context a frontier model's native web-search tool pulls per
    call (OpenAI `web_search.search_context_size`): the cost/recall dial."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ReasoningEffort(StrEnum):
    """A reasoning model's thinking budget (OpenAI `reasoning.effort`). Mirrors the
    values the Responses API accepts; not every model supports every level."""

    NONE = "none"
    MINIMAL = "minimal"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    XHIGH = "xhigh"


class LLMProvider(StrEnum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"


class LLMRole(StrEnum):
    """The distinct LLM call sites. Each is configured with its own model,
    temperature, and system prompt under `[llm.roles.<role>]` in `config.toml`;
    every role listed here must be present there (enforced by `LLMSettings`)."""

    DOMAIN_CLASSIFIER = "domain_classifier"  # picks a saved query's attribute domain
    QUERY_EXPANDER = "query_expander"  # translates a saved query into per-language searches
    DEDUP_JUDGE = "dedup_judge"  # tiebreak same-item judge
    RANK_RERANKER = "rank_reranker"  # preference reranker
    FEEDBACK_SUMMARY = "feedback_summary"  # NL taste-summary rewriter


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


class LogLevel(StrEnum):
    """Standard logging thresholds; members map to `logging`'s level names so a
    value passes straight to `setLevel` / `basicConfig`."""

    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class NoisyLogger(StrEnum):
    """Third-party loggers `setup_logging` pins below the root level so their
    chatter (asyncio's selector messages, httpx's per-request lines) doesn't
    flood when the app baseline is turned down to DEBUG. Mirrors the per-logger
    sections in `logging.ini` that cover the ad-hoc-script path."""

    HTTPX = "httpx"
    ASYNCIO = "asyncio"
    FSEVENTS = "fsevents"
    HTTPCORE_CONNECTION = "httpcore.connection"
    HTTPCORE_HTTP11 = "httpcore.http11"
    OPENAI_BASE_CLIENT = "openai._base_client"
