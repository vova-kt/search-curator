"""Rank stage: order canonical results for one saved query, given its preference
profile (design: ``docs/preferences.md``).

`PreferenceRanker` runs the documented flow: a cheap always-on taste-vector
prefilter (cosine to the profile's liked-minus-disliked centroids, ``_score.py``)
trims the set to ``top_n``, an LLM reranker fed the profile's natural-language
summary orders that set (``_rerank.py``), and a couple of exploration slots are
reserved for the most *uncertain* leftover candidates so the ranking doesn't
collapse onto past likes and starve the feedback signal. The taste prefilter
reuses each canonical's stored embedding and only embeds (batched, rule 5) the
results that lack one.

The logistic-regression blender named in the design remains future work: fitting
it needs the individual labelled vectors, which the stage doesn't receive (it gets
the centroid profile, not the feedback history) — wiring those through is the next
step, tracked in ``docs/preferences.md``.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Protocol

from events_curator.embed import Embedder
from events_curator.enums import Stage
from events_curator.llm import LLMClient
from events_curator.models import (
    CanonicalSearchResult,
    CanonicalSearchResultId,
    PreferenceProfile,
    RankedSearchResult,
    SavedQuery,
    Vector,
)
from events_curator.rank._rerank import build_rerank_prompt, parse_rerank
from events_curator.rank._score import doc_text, taste_score

# Per-stage logger (`events_curator.stage.rank`); the orchestrator owns the INFO
# milestones, so the per-run ranking detail here lives at DEBUG.
_LOG = logging.getLogger(f"events_curator.stage.{Stage.RANK.value}")


class Ranker(Protocol):
    async def rank(
        self,
        results: Sequence[CanonicalSearchResult],
        profile: PreferenceProfile,
        *,
        query: SavedQuery,
    ) -> list[RankedSearchResult]: ...


class PreferenceRanker:
    """Taste-vector prefilter + LLM reranker + exploration slots. Drives an
    `Embedder` (the prefilter signal) and an `LLMClient` (the reranker); both
    default to the Unconfigured placeholders in the builder, so a live run raises
    with a pointer to the `embed`/`llm` extra until real ones are wired."""

    def __init__(
        self,
        embedder: Embedder,
        reranker: LLMClient,
        *,
        system_prompt: str,
        model: str,
        temperature: float = 0.0,
        top_n: int = 25,
        exploration_slots: int = 2,
    ) -> None:
        self._embedder = embedder
        self._reranker = reranker
        self._system_prompt = system_prompt
        self._model = model
        self._temperature = temperature
        self._top_n = top_n
        self._exploration_slots = exploration_slots

    async def rank(
        self,
        results: Sequence[CanonicalSearchResult],
        profile: PreferenceProfile,
        *,
        query: SavedQuery,
    ) -> list[RankedSearchResult]:
        if not results:
            _LOG.warning("rank called with no results for saved query %s", query.id)
            return []
        _LOG.debug("ranking %d result(s) for saved query %s", len(results), query.id)
        embeddings = await self._embeddings(results)
        scores = {r.id: taste_score(embeddings[i], profile) for i, r in enumerate(results)}
        by_taste = sorted(results, key=lambda r: scores[r.id], reverse=True)
        out_n = min(self._top_n, len(by_taste))
        head, leftover = by_taste[:out_n], by_taste[out_n:]
        _LOG.debug(
            "taste prefilter kept %d head, %d leftover (top_n=%d)",
            out_n,
            len(leftover),
            self._top_n,
        )

        reranked, rationale = await self._rerank(head, profile, query)
        explore = sorted(leftover, key=lambda r: abs(scores[r.id]))[: self._exploration_slots]
        keep = max(out_n - len(explore), 0)
        ordered = reranked[:keep] + explore
        explore_ids = {r.id for r in explore}
        _LOG.debug(
            "ranked %d result(s): %d reranked + %d exploration slot(s)",
            len(ordered),
            keep,
            len(explore),
        )
        return [
            RankedSearchResult(
                canonical_search_result_id=r.id,
                score=scores[r.id],
                rank=position,
                rationale=None if r.id in explore_ids else rationale.get(r.id),
                is_exploration=r.id in explore_ids,
            )
            for position, r in enumerate(ordered)
        ]

    async def _embeddings(self, results: Sequence[CanonicalSearchResult]) -> list[Vector]:
        missing = [(i, doc_text(r)) for i, r in enumerate(results) if r.embedding is None]
        filled: dict[int, Vector] = {}
        if missing:
            _LOG.warning(
                "embedding %d of %d result(s) lacking a stored vector", len(missing), len(results)
            )
            # Rule 5: every result lacking an embedding is embedded in one batch.
            vectors = await self._embedder.embed([text for _, text in missing])
            filled = {i: v for (i, _), v in zip(missing, vectors, strict=True)}
        return [
            r.embedding if r.embedding is not None else filled[i] for i, r in enumerate(results)
        ]

    async def _rerank(
        self,
        head: list[CanonicalSearchResult],
        profile: PreferenceProfile,
        query: SavedQuery,
    ) -> tuple[list[CanonicalSearchResult], dict[CanonicalSearchResultId, str]]:
        prompt = build_rerank_prompt(
            self._system_prompt, head, summary=profile.nl_summary, query=query
        )
        reply = await self._reranker.complete(
            prompt, model=self._model, temperature=self._temperature
        )
        order = parse_rerank(reply, count=len(head))
        seen = {index for index, _ in order}
        order += [(i, None) for i in range(len(head)) if i not in seen]
        ranked = [head[index] for index, _ in order]
        rationale = {head[index].id: why for index, why in order if why is not None}
        _LOG.debug(
            "reranker ordered %d/%d head item(s), %d with rationale",
            len(seen),
            len(head),
            len(rationale),
        )
        return ranked, rationale


__all__ = ["PreferenceRanker", "Ranker"]
