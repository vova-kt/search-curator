"""Default wiring. Assembles a pipeline from config: the real IdentityExpander,
the real FrontierWebSearch engine, the RRFMerger, the real ThresholdDeduper, the
real PreferenceRanker, and the real ProfileUpdater over the in-memory store.

The adapters those stages drive — the web-search backend, the LLM client, and the
embedder — are chosen from config by the `build_search_backend`, `build_llm`, and
`build_embedder` factories. The search backend and LLM return the real OpenAI
adapter once it's usable (an API key is set and the `llm` extra is installed); the
embedder defaults to the local bge-small `SentenceTransformer` (extra `embed`) and
can instead use the OpenAI embeddings API. When the selected backend isn't usable
each factory falls back to the matching `Unconfigured*` placeholder, which raises
with a pointer to what to wire next — so a default, keyless run reaches the
web-search placeholder and stops there before any later stage runs.

Three more config-driven factories live here so every UI wires the same way:
`build_storage` picks the persistent SQLite store (or the in-memory store for
`:memory:`), `build_authenticator` picks the `Authenticator` for the configured
`AuthScheme`, and `build_search_engine` picks the `SearchEngine` for the configured
`SearchEngineKind`."""

from __future__ import annotations

import importlib.util

from events_curator.auth import Authenticator, LocalAuthenticator, TelegramAuthenticator
from events_curator.config import AppConfig, get_config
from events_curator.dedup import ThresholdDeduper
from events_curator.embed import Embedder, UnconfiguredEmbedder
from events_curator.enums import AuthScheme, EmbedderKind, LLMProvider, LLMRole, SearchEngineKind
from events_curator.expand import IdentityExpander
from events_curator.feedback import ProfileUpdater
from events_curator.llm import LLMClient, UnconfiguredLLM
from events_curator.merge import RRFMerger
from events_curator.pipeline.orchestrator import CurationPipeline, Stages
from events_curator.rank import PreferenceRanker
from events_curator.search import (
    FrontierWebSearch,
    SearchEngine,
    UnconfiguredWebSearch,
    WebSearchBackend,
    WebSearchTuning,
)
from events_curator.storage import InMemoryStorage, Storage

IN_MEMORY_DB_PATH = ":memory:"


def _openai_ready(config: AppConfig) -> bool:
    """Whether the OpenAI-backed adapters can be built: an API key is configured and
    the `llm` extra (the `openai` package) is importable. When false the builder
    falls back to an `Unconfigured*` placeholder that raises a pointer when used."""
    return bool(config.llm.api_key) and importlib.util.find_spec("openai") is not None


def build_embedder(config: AppConfig) -> Embedder:
    """The embedder for the configured `EmbedderKind`: the local bge-small
    `SentenceTransformer` (`BGE_SMALL`, extra `embed`) or OpenAI's embeddings API
    (`OPENAI`, extra `llm`, reusing the `llm` key). Falls back to
    `UnconfiguredEmbedder` when the selected backend isn't usable — the `embed`
    extra missing for bge, or no key/`llm` extra for OpenAI — so an unconfigured run
    reaches the placeholder and stops with a pointer to what to wire next."""
    match config.embedding.kind:
        case EmbedderKind.BGE_SMALL:
            if importlib.util.find_spec("sentence_transformers") is None:
                return UnconfiguredEmbedder()
            from events_curator.embed import BgeEmbedder  # noqa: PLC0415  (keeps `embed` optional)

            return BgeEmbedder(model=config.embedding.model)
        case EmbedderKind.OPENAI:
            if not _openai_ready(config):
                return UnconfiguredEmbedder()
            from events_curator.embed import OpenAIEmbedder  # noqa: PLC0415  (keeps `llm` optional)

            return OpenAIEmbedder(model=config.embedding.model, api_key=config.llm.api_key)


def build_llm(config: AppConfig) -> LLMClient:
    """The LLM client for the configured `LLMProvider`: `OpenAIChat` when usable,
    else `UnconfiguredLLM`. The client is stateless about model/temperature — those
    are per-call (`LLMClient.complete`), resolved per call site via
    `config.llm.for_role` and passed by each stage, so one client serves them all.
    Anthropic is enumerated but has no adapter yet."""
    match config.llm.provider:
        case LLMProvider.OPENAI:
            if not _openai_ready(config):
                return UnconfiguredLLM()
            from events_curator.llm import OpenAIChat  # noqa: PLC0415  (keeps `llm` optional)

            return OpenAIChat(api_key=config.llm.api_key)
        case LLMProvider.ANTHROPIC:
            raise NotImplementedError(
                "ANTHROPIC provider has no LLMClient yet; add one in llm/ and wire it here."
            )


def build_search_backend(config: AppConfig) -> WebSearchBackend:
    """The backend the frontier engine drives: OpenAI's native web-search tool when
    usable, else `UnconfiguredWebSearch`. Reuses the `llm` model/key and takes its
    steering prompt and tool tuning from `[search]`. The geographic bias is not
    config — it's the requesting user's `location`, threaded in per run."""
    if not _openai_ready(config):
        return UnconfiguredWebSearch()
    from events_curator.search import OpenAIWebSearch  # noqa: PLC0415  (keeps `llm` optional)

    return OpenAIWebSearch(
        model=config.llm.model,
        api_key=config.llm.api_key,
        instructions=config.search.instructions,
        tuning=WebSearchTuning(
            search_context_size=config.search.search_context_size,
            reasoning_effort=config.search.reasoning_effort,
            allowed_domains=list(config.search.allowed_domains),
        ),
    )


def build_search_engine(config: AppConfig) -> SearchEngine:
    """The search engine for the configured `SearchEngineKind`. Only the frontier
    native engine ships; the other kinds are enumerated but have no adapter yet."""
    if config.search.engine is SearchEngineKind.FRONTIER_NATIVE:
        return FrontierWebSearch(
            build_search_backend(config), max_results=config.search.max_results_per_query
        )
    raise NotImplementedError(
        f"No engine adapter for '{config.search.engine.value}'; only FRONTIER_NATIVE ships."
    )


def build_default_stages(config: AppConfig) -> Stages:
    # One embedder and one LLM client, shared across the stages that need them, so a
    # real adapter opens a single backing client rather than one per stage. The LLM
    # client is model/temperature-agnostic; each stage carries its own call site's
    # model/temperature/prompt (`config.llm.for_role`) and passes them per call, so a
    # single client still serves every call site.
    embedder = build_embedder(config)
    llm = build_llm(config)
    judge = config.llm.for_role(LLMRole.DEDUP_JUDGE)
    reranker = config.llm.for_role(LLMRole.RANK_RERANKER)
    summary = config.llm.for_role(LLMRole.FEEDBACK_SUMMARY)
    return Stages(
        expander=IdentityExpander(),
        search=build_search_engine(config),
        merger=RRFMerger(k=config.search.rrf_k),
        deduper=ThresholdDeduper(
            embedder,
            llm,
            system_prompt=judge.prompt,
            model=judge.model,
            temperature=judge.temperature,
            auto_merge_threshold=config.dedup.auto_merge_threshold,
            tiebreak_low_threshold=config.dedup.tiebreak_low_threshold,
            block_window_days=config.dedup.block_window_days,
        ),
        ranker=PreferenceRanker(
            embedder,
            llm,
            system_prompt=reranker.prompt,
            model=reranker.model,
            temperature=reranker.temperature,
            top_n=config.rank.top_n,
            exploration_slots=config.rank.exploration_slots,
        ),
        learner=ProfileUpdater(
            embedder,
            llm,
            system_prompt=summary.prompt,
            model=summary.model,
            temperature=summary.temperature,
        ),
    )


def build_storage(config: AppConfig) -> Storage:
    """Storage from config: the dependency-free in-memory store when `db_path` is
    `:memory:` (tests/eval), else `SqliteStorage` at the configured path. SQLite is
    imported lazily so the `store` extra is only required when actually selected.
    The returned store still needs `await storage.init()` before use."""
    if config.storage.db_path == IN_MEMORY_DB_PATH:
        return InMemoryStorage()
    from events_curator.storage import SqliteStorage  # noqa: PLC0415  (keeps `store` optional)

    return SqliteStorage(config.storage.db_path)


def build_authenticator(config: AppConfig) -> Authenticator:
    """The `Authenticator` for the configured `AuthScheme`. Adding a scheme means
    adding its case here alongside the `Authenticator` implementation in `auth/`."""
    match config.auth.scheme:
        case AuthScheme.LOCAL:
            return LocalAuthenticator()
        case AuthScheme.TELEGRAM:
            return TelegramAuthenticator()
        case AuthScheme.API_TOKEN:
            raise NotImplementedError(
                "API_TOKEN scheme has no Authenticator yet; add one in auth/ and wire it here."
            )


def build_default_pipeline(
    config: AppConfig | None = None,
    storage: Storage | None = None,
) -> CurationPipeline:
    config = config or get_config()
    return CurationPipeline(
        stages=build_default_stages(config),
        storage=storage or InMemoryStorage(),
    )
