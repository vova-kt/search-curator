"""Default wiring. Assembles a pipeline from config using the shipped stage
implementations: the real IdentityExpander and RRFMerger, the in-memory store,
and the not-yet-implemented search/dedup/rank/feedback stubs. Running it works
up to the first stub, which raises with a pointer to what to wire next."""

from __future__ import annotations

from events_curator.config import AppConfig, get_config
from events_curator.dedup import ThresholdDeduper
from events_curator.expand import IdentityExpander
from events_curator.feedback import ProfileUpdater
from events_curator.merge import RRFMerger
from events_curator.pipeline.orchestrator import CurationPipeline, Stages
from events_curator.rank import PreferenceRanker
from events_curator.search import FrontierWebSearch
from events_curator.storage import InMemoryStorage, Storage


def build_default_stages(config: AppConfig) -> Stages:
    return Stages(
        expander=IdentityExpander(),
        search=FrontierWebSearch(),
        merger=RRFMerger(k=config.search.rrf_k),
        deduper=ThresholdDeduper(),
        ranker=PreferenceRanker(),
        learner=ProfileUpdater(),
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
