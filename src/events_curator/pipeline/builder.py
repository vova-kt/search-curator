"""Default wiring. Assembles a pipeline from config."""

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
    return bool(config.llm.api_key) and importlib.util.find_spec("openai") is not None


def build_embedder(config: AppConfig) -> Embedder:
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
    if not _openai_ready(config):
        return UnconfiguredWebSearch()
    from events_curator.search import OpenAIWebSearch  # noqa: PLC0415  (keeps `llm` optional)

    return OpenAIWebSearch(
        model=config.llm.model,
        api_key=config.llm.api_key,
        instructions=config.search.instructions,
        prompt=config.search.prompt,
        tuning=WebSearchTuning(
            search_context_size=config.search.search_context_size,
            reasoning_effort=config.search.reasoning_effort,
            allowed_domains=list(config.search.allowed_domains),
        ),
    )


def build_search_engine(config: AppConfig) -> SearchEngine:
    if config.search.engine is SearchEngineKind.FRONTIER_NATIVE:
        return FrontierWebSearch(
            build_search_backend(config), max_results=config.search.max_results_per_query
        )
    raise NotImplementedError(
        f"No engine adapter for '{config.search.engine.value}'; only FRONTIER_NATIVE ships."
    )


def build_default_stages(config: AppConfig) -> Stages:
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
    if config.storage.db_path == IN_MEMORY_DB_PATH:
        return InMemoryStorage()
    from events_curator.storage import SqliteStorage  # noqa: PLC0415  (keeps `store` optional)

    return SqliteStorage(config.storage.db_path)


def build_authenticator(config: AppConfig) -> Authenticator:
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
