"""Dedup stage: reconcile fresh candidates against the stored corpus, both within
this run and across past sessions.

Entity resolution in three parts (concept: ``docs/concepts/entity-resolution.md``):
canonicalize the URL (done upstream at ingestion), *block* on date(±N days)+city to
avoid all-pairs comparison, then score similarity — MinHash on text fused with
embedding cosine (``_match.py``). Above ``auto_merge_threshold`` → merge; in the
tiebreak band → an LLM judge decides (``_judge.py``); below → insert new. Merges
build a golden record by survivorship and keep provenance (``_golden.py``).

The cross-session lookup is the store's ``nearest`` (date+city window), so dedup
depends only on the ``SearchResultStore`` read side. Within-run dedup falls out of
the same path: each new/updated canonical is upserted immediately, so a later
candidate's ``nearest`` already sees it; an exact-URL index short-circuits the
common case where two candidates share one canonical URL.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol

from events_curator.dedup._golden import doc_text, merge_into, new_golden
from events_curator.dedup._judge import build_judge_prompt, parse_judge_verdict
from events_curator.dedup._match import combined_similarity, jaccard, text_signature
from events_curator.embed import Embedder
from events_curator.enums import DedupDecision, Stage
from events_curator.llm import LLMClient
from events_curator.models import (
    CanonicalSearchResult,
    CanonicalSearchResultId,
    DedupOutcome,
    Provenance,
    RawSearchResult,
    Vector,
)
from events_curator.storage import SearchResultStore

# Per-stage logger (`events_curator.stage.dedup`); the orchestrator owns the INFO
# milestones, so the per-candidate decision trace here lives at DEBUG.
_LOG = logging.getLogger(f"events_curator.stage.{Stage.DEDUP.value}")


class Deduper(Protocol):
    async def reconcile(
        self, candidates: Sequence[RawSearchResult], results: SearchResultStore
    ) -> list[DedupOutcome]:
        """Reconcile candidates against the stored corpus.

        Contract: upserts the resulting canonical results into `results` and
        returns one outcome per candidate with `canonical_search_result_id` set to
        the canonical record it landed in (new or existing).
        """
        ...


@dataclass
class _RunState:
    """The canonicals in play this run: the corpus seen so far plus what we create,
    indexed for exact-URL short-circuit and provenance accumulation."""

    url_index: dict[str, CanonicalSearchResultId] = field(
        default_factory=dict[str, CanonicalSearchResultId]
    )
    by_id: dict[CanonicalSearchResultId, CanonicalSearchResult] = field(
        default_factory=dict[CanonicalSearchResultId, CanonicalSearchResult]
    )
    provenance: dict[CanonicalSearchResultId, Provenance] = field(
        default_factory=dict[CanonicalSearchResultId, Provenance]
    )

    def remember(self, canonical: CanonicalSearchResult, provenance: Provenance) -> None:
        self.by_id[canonical.id] = canonical
        self.provenance[canonical.id] = provenance
        self.url_index[canonical.url] = canonical.id


class ThresholdDeduper(Deduper):
    """Blocking + two-threshold similarity with an LLM tiebreak judge. Drives an
    `Embedder` (semantic signal) and an `LLMClient` (the judge); both default to
    the Unconfigured placeholders, so a run raises with a pointer to the extra to
    wire until real ones are swapped in (same shape as the search backend)."""

    def __init__(
        self,
        embedder: Embedder,
        judge: LLMClient,
        *,
        system_prompt: str,
        model: str,
        temperature: float = 0.0,
        auto_merge_threshold: float = 0.88,
        tiebreak_low_threshold: float = 0.75,
        block_window_days: int = 1,
        block_limit: int = 10,
    ) -> None:
        self._embedder = embedder
        self._judge = judge
        self._system_prompt = system_prompt
        self._model = model
        self._temperature = temperature
        self._auto_merge_threshold = auto_merge_threshold
        self._tiebreak_low_threshold = tiebreak_low_threshold
        self._block_window_days = block_window_days
        self._block_limit = block_limit

    async def reconcile(
        self, candidates: Sequence[RawSearchResult], results: SearchResultStore
    ) -> list[DedupOutcome]:
        if not candidates:
            _LOG.debug("reconcile called with no candidates; nothing to do")
            return []
        _LOG.debug("reconciling %d candidate(s) against the corpus", len(candidates))
        # Rule 5: all candidate embeddings are known up front -> one batched call.
        vectors = await self._embedder.embed([doc_text(c) for c in candidates])
        state = _RunState()
        outcomes: list[DedupOutcome] = []
        for candidate, vector in zip(candidates, vectors, strict=True):
            outcomes.append(await self._reconcile_one(candidate, vector, results, state))
        _LOG.debug(
            "reconcile done: %d outcome(s) across %d canonical(s)",
            len(outcomes),
            len(state.by_id),
        )
        return outcomes

    async def _reconcile_one(
        self,
        candidate: RawSearchResult,
        vector: Vector,
        results: SearchResultStore,
        state: _RunState,
    ) -> DedupOutcome:
        same_url = state.url_index.get(candidate.url)
        if same_url is not None:
            _LOG.debug(
                "_reconcile_one: exact-URL hit for %s -> merging into %s", candidate.url, same_url
            )
            return await self._merge(candidate, results, state, state.by_id[same_url], 1.0)

        match = await self._best_match(candidate, vector, results)
        if match is None:
            _LOG.debug("_reconcile_one: no block match for %s -> inserting new", candidate.url)
            return await self._insert(candidate, vector, results, state, similarity=None)
        target, sim = match
        if sim >= self._auto_merge_threshold:
            _LOG.debug(
                "_reconcile_one: auto-merge %s into %s (sim=%.3f >= %.3f)",
                candidate.url,
                target.id,
                sim,
                self._auto_merge_threshold,
            )
            return await self._merge(candidate, results, state, target, sim)
        if sim >= self._tiebreak_low_threshold:
            decision = DedupDecision.TIEBREAK
            _LOG.debug(
                "_reconcile_one: tiebreak band for %s vs %s (sim=%.3f); consulting judge",
                candidate.url,
                target.id,
                sim,
            )
            if await self._judge_same(candidate, target):
                _LOG.debug(
                    "_reconcile_one: judge: same -> merging %s into %s", candidate.url, target.id
                )
                return await self._merge(candidate, results, state, target, sim, decision)
            _LOG.debug("_reconcile_one: judge: distinct -> inserting %s as new", candidate.url)
            return await self._insert(
                candidate, vector, results, state, similarity=sim, decision=decision
            )
        _LOG.debug(
            "_reconcile_one: below tiebreak band for %s (sim=%.3f < %.3f) -> inserting new",
            candidate.url,
            sim,
            self._tiebreak_low_threshold,
        )
        return await self._insert(candidate, vector, results, state, similarity=sim)

    async def _best_match(
        self, candidate: RawSearchResult, vector: Vector, results: SearchResultStore
    ) -> tuple[CanonicalSearchResult, float] | None:
        matches = await results.nearest(
            vector,
            on_date=candidate.starts_at,
            within_days=self._block_window_days,
            city=candidate.geo.city,
            limit=self._block_limit,
        )
        if not matches:
            _LOG.debug(
                "_best_match: block empty for %s (date±%dd, city=%s)",
                candidate.url,
                self._block_window_days,
                candidate.geo.city,
            )
            return None
        _LOG.debug("_best_match: block has %d candidate(s) for %s", len(matches), candidate.url)
        signature = text_signature(doc_text(candidate))
        best: tuple[CanonicalSearchResult, float] | None = None
        for other, cosine in matches:
            sim = combined_similarity(cosine, jaccard(signature, text_signature(doc_text(other))))
            if best is None or sim > best[1]:
                best = (other, sim)
        if best is not None:
            _LOG.debug(
                "_best_match: best block match for %s is %s (sim=%.3f)",
                candidate.url,
                best[0].id,
                best[1],
            )
        return best

    async def _merge(
        self,
        candidate: RawSearchResult,
        results: SearchResultStore,
        state: _RunState,
        target: CanonicalSearchResult,
        similarity: float,
        decision: DedupDecision = DedupDecision.AUTO_MERGE,
    ) -> DedupOutcome:
        prior = state.provenance.get(target.id) or Provenance(canonical_search_result_id=target.id)
        merged, provenance = merge_into(target, prior, candidate)
        await results.upsert_canonical(merged, provenance)
        state.remember(merged, provenance)
        state.url_index[candidate.url] = merged.id
        return DedupOutcome(
            candidate=candidate,
            decision=decision,
            canonical_search_result_id=merged.id,
            similarity=similarity,
        )

    async def _insert(
        self,
        candidate: RawSearchResult,
        vector: Vector,
        results: SearchResultStore,
        state: _RunState,
        *,
        similarity: float | None,
        decision: DedupDecision = DedupDecision.INSERT_NEW,
    ) -> DedupOutcome:
        canonical, provenance = new_golden(candidate, vector)
        await results.upsert_canonical(canonical, provenance)
        state.remember(canonical, provenance)
        return DedupOutcome(
            candidate=candidate,
            decision=decision,
            canonical_search_result_id=canonical.id,
            similarity=similarity,
        )

    async def _judge_same(self, candidate: RawSearchResult, other: CanonicalSearchResult) -> bool:
        reply = await self._judge.complete(
            build_judge_prompt(self._system_prompt, candidate, other),
            model=self._model,
            temperature=self._temperature,
        )
        return parse_judge_verdict(reply)


__all__ = ["Deduper", "ThresholdDeduper"]
