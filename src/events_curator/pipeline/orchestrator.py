"""The UI-agnostic curation pipeline: expand → search → merge → dedup → store →
rank, plus the feedback path. Every UI (Telegram bot, Streamlit, scheduler,
eval) drives the same object.

Ownership is enforced here: a principal may only run / give feedback on its own
saved queries. Preferences are read per saved query, so personalization is
scoped to the recurrent search, not the user.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from events_curator.auth import ensure_owner
from events_curator.dedup import Deduper
from events_curator.enums import ProgressPhase, Stage
from events_curator.expand import Expander
from events_curator.feedback import PreferenceLearner
from events_curator.merge import Merger
from events_curator.models import (
    Feedback,
    GeoBias,
    PreferenceProfile,
    Principal,
    RankedSearchResult,
    SavedQueryId,
)
from events_curator.pipeline.progress import ProgressEvent, ProgressListener
from events_curator.rank import Ranker
from events_curator.search import DomainClassifier, SearchEngine
from events_curator.storage import Storage

# One logger per stage (`events_curator.stage.<name>`) so an operator can tune the
# verbosity of a single stage independently of the rest.
_STAGE_LOG = {stage: logging.getLogger(f"events_curator.stage.{stage.value}") for stage in Stage}
_LOG = logging.getLogger(__name__)


class _Reporter:
    """Fans one stage milestone out to both the per-stage logger and (when a run
    supplies one) the progress listener, so the operator's trace and the logs stay
    in step. `start` announces slow work at `DEBUG`; `done` reports its result at
    `INFO` — the milestone level the docs promise."""

    def __init__(self, listener: ProgressListener | None) -> None:
        self._listener = listener

    def start(self, stage: Stage, detail: str) -> None:
        _STAGE_LOG[stage].debug("%s", detail)
        self._emit(stage, ProgressPhase.START, detail)

    def done(self, stage: Stage, detail: str) -> None:
        _STAGE_LOG[stage].info("%s", detail)
        self._emit(stage, ProgressPhase.DONE, detail)

    def _emit(self, stage: Stage, phase: ProgressPhase, detail: str) -> None:
        if self._listener is not None:
            self._listener.on_progress(ProgressEvent(stage=stage, phase=phase, detail=detail))


@dataclass(frozen=True)
class Stages:
    """The pluggable stage implementations a pipeline runs with."""

    classifier: DomainClassifier
    expander: Expander
    search: SearchEngine
    merger: Merger
    deduper: Deduper
    ranker: Ranker
    learner: PreferenceLearner


class UnknownSavedQueryError(LookupError):
    """Raised when a run/feedback targets a saved query that does not exist."""


class CurationPipeline:
    def __init__(self, stages: Stages, storage: Storage) -> None:
        self._stages = stages
        self._storage = storage

    async def run(
        self,
        saved_query_id: SavedQueryId,
        principal: Principal,
        *,
        unseen_only: bool = False,
        on_progress: ProgressListener | None = None,
    ) -> list[RankedSearchResult]:
        query = await self._storage.queries.get(saved_query_id)
        if query is None:
            raise UnknownSavedQueryError(saved_query_id)
        ensure_owner(principal, query)
        _LOG.info("run saved query %s (owner %s)", query.id, principal.user_id)
        report = _Reporter(on_progress)

        report.start(Stage.EXPAND, "Expanding the saved query into web searches…")
        # Derive the attribute domain once and cache it on the saved query (it shapes
        # which `attributes` keys search requests). Re-derived only if never classified.
        domain = query.domain
        if domain is None:
            domain = await self._stages.classifier.classify(query.text)
            query.domain = domain
            await self._storage.queries.upsert(query)
        expanded = await self._stages.expander.expand(query)
        report.done(
            Stage.EXPAND,
            f"Expanded into {len(expanded.queries)} web search(es) [domain={domain}]",
        )

        # Location is a per-user attribute, not deployment config: bias the search by
        # where the requesting user is. Absent user/location means no geographic bias.
        user = await self._storage.users.get(principal.user_id)
        location = user.location if user is not None else GeoBias()

        # Rule 5: every expanded query is searched concurrently.
        report.start(
            Stage.SEARCH, f"Searching the web — {len(expanded.queries)} query(ies) in parallel…"
        )
        per_query = await asyncio.gather(
            *[
                self._stages.search.search(q, location=location, domain=domain)
                for q in expanded.queries
            ]
        )
        report.done(Stage.SEARCH, f"Search returned {len(per_query)} result list(s)")

        merged = self._stages.merger.merge(per_query)
        report.done(Stage.MERGE, f"Fused results into {len(merged)} candidate(s)")

        await self._storage.results.add_raw(merged)
        report.done(Stage.STORE, f"Stored {len(merged)} raw candidate(s)")

        report.start(Stage.DEDUP, f"Reconciling {len(merged)} candidate(s) against the corpus…")
        outcomes = await self._stages.deduper.reconcile(merged, self._storage.results)
        canonical_ids = [
            o.canonical_search_result_id
            for o in outcomes
            if o.canonical_search_result_id is not None
        ]
        report.done(Stage.DEDUP, f"Reconciled into {len(canonical_ids)} canonical result(s)")

        await self._storage.results.link_results(query.id, canonical_ids)
        report.done(Stage.STORE, f"Linked {len(canonical_ids)} result(s) to the saved query")

        results = await self._storage.results.results_for_query(query.id)
        # The bot's "don't repeat" guarantee: drop canonicals already delivered to
        # this user (via any saved query) before ranking, so a run only surfaces new
        # material. Off by default — eval and the Streamlit view want the full set.
        if unseen_only:
            shown = await self._storage.results.shown_ids_for_user(principal.user_id)
            before = len(results)
            results = [r for r in results if r.id not in shown]
            report.done(Stage.RANK, f"Filtered to {len(results)} unseen of {before} result(s)")
        profile = await self._storage.preferences.get(query.id) or PreferenceProfile(
            saved_query_id=query.id
        )
        report.start(Stage.RANK, "Ranking results by this query's learned taste…")
        ranked = await self._stages.ranker.rank(results, profile, query=query)
        report.done(Stage.RANK, f"Ranked {len(ranked)} result(s)")
        return ranked

    async def record_feedback(self, feedback: Feedback, principal: Principal) -> PreferenceProfile:
        query = await self._storage.queries.get(feedback.saved_query_id)
        if query is None:
            raise UnknownSavedQueryError(feedback.saved_query_id)
        ensure_owner(principal, query)
        _LOG.info(
            "feedback %s on result %s (query %s)",
            feedback.kind.value,
            feedback.canonical_search_result_id,
            feedback.saved_query_id,
        )
        return await self._stages.learner.record(
            feedback,
            feedback_store=self._storage.feedback,
            preference_store=self._storage.preferences,
            result_store=self._storage.results,
        )
