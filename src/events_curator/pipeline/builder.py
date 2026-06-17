"""Default wiring. Assembles a pipeline from config using the shipped stage
implementations: the real IdentityExpander, the real FrontierWebSearch engine
(driving the UnconfiguredWebSearch backend until the `llm` extra is wired), the
RRFMerger, the real ThresholdDeduper, the real PreferenceRanker, and the real
ProfileUpdater — the last three driving the UnconfiguredEmbedder + UnconfiguredLLM
until the `embed`/`llm` extras are wired — over the in-memory store. Running it
works up to the first unconfigured adapter, which raises with a pointer to what to
wire next."""

from __future__ import annotations

from events_curator.config import AppConfig, get_config
from events_curator.dedup import ThresholdDeduper
from events_curator.embed import UnconfiguredEmbedder
from events_curator.expand import IdentityExpander
from events_curator.feedback import ProfileUpdater
from events_curator.llm import UnconfiguredLLM
from events_curator.merge import RRFMerger
from events_curator.pipeline.orchestrator import CurationPipeline, Stages
from events_curator.rank import PreferenceRanker
from events_curator.search import FrontierWebSearch, UnconfiguredWebSearch
from events_curator.storage import InMemoryStorage, Storage


def build_default_stages(config: AppConfig) -> Stages:
    return Stages(
        expander=IdentityExpander(),
        search=FrontierWebSearch(
            UnconfiguredWebSearch(), max_results=config.search.max_results_per_query
        ),
        merger=RRFMerger(k=config.search.rrf_k),
        deduper=ThresholdDeduper(
            UnconfiguredEmbedder(),
            UnconfiguredLLM(),
            auto_merge_threshold=config.dedup.auto_merge_threshold,
            tiebreak_low_threshold=config.dedup.tiebreak_low_threshold,
            block_window_days=config.dedup.block_window_days,
        ),
        ranker=PreferenceRanker(
            UnconfiguredEmbedder(),
            UnconfiguredLLM(),
            top_n=config.rank.top_n,
            exploration_slots=config.rank.exploration_slots,
        ),
        learner=ProfileUpdater(UnconfiguredEmbedder(), UnconfiguredLLM()),
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
