"""PreferenceRanker orders results by a taste-vector prefilter then an LLM rerank,
reserving exploration slots for the most uncertain leftover candidates and reusing
stored embeddings. Plus the dependency-free helpers: taste scoring and the rerank
prompt/parse contract."""

from __future__ import annotations

import json
from collections.abc import Sequence

from events_curator.models import (
    CanonicalSearchResult,
    Geo,
    PreferenceProfile,
    RankedSearchResult,
    SavedQuery,
    UserId,
    Vector,
)
from events_curator.rank import PreferenceRanker
from events_curator.rank._rerank import build_rerank_prompt, parse_rerank
from events_curator.rank._score import cosine, doc_text, taste_score


class FakeEmbedder:
    def __init__(self, by_title: dict[str, Vector]) -> None:
        self._by_title = by_title
        self.calls = 0

    async def embed(self, texts: Sequence[str]) -> list[Vector]:
        self.calls += 1
        return [self._by_title[text.split("\n", 1)[0]] for text in texts]


class FakeReranker:
    """Returns a preset reply and records the prompts it saw."""

    def __init__(self, reply: str) -> None:
        self._reply = reply
        self.calls = 0

    async def complete(self, messages: object, *, model: str, temperature: float = 0.0) -> str:
        del messages, model, temperature
        self.calls += 1
        return self._reply


def _result(
    title: str, *, embedding: Vector | None = None, city: str = "Berlin"
) -> CanonicalSearchResult:
    return CanonicalSearchResult(
        url=f"https://e.com/{title.replace(' ', '-')}",
        title=title,
        geo=Geo(city=city),
        embedding=embedding,
    )


def _query() -> SavedQuery:
    return SavedQuery(user_id=UserId("u1"), text="jazz in berlin")


def _ranking_reply(*ids: int) -> str:
    return json.dumps({"ranking": [{"id": i, "why": f"reason {i}"} for i in ids]})


# --- _score ----------------------------------------------------------------


def test_cosine_identical_is_one() -> None:
    assert cosine([1.0, 0.0], [1.0, 0.0]) == 1.0


def test_cosine_orthogonal_is_zero() -> None:
    assert cosine([1.0, 0.0], [0.0, 1.0]) == 0.0


def test_cosine_empty_or_mismatched_is_zero() -> None:
    assert cosine([], [1.0]) == 0.0
    assert cosine([1.0, 0.0], [1.0]) == 0.0


def test_taste_score_rewards_liked_axis() -> None:
    profile = PreferenceProfile(
        saved_query_id=_query().id,
        liked_centroid=[1.0, 0.0],
        disliked_centroid=[0.0, 1.0],
    )
    assert taste_score([1.0, 0.0], profile) == 1.0  # on liked, off disliked
    assert taste_score([0.0, 1.0], profile) == -1.0  # on disliked, off liked


def test_taste_score_cold_start_is_zero() -> None:
    profile = PreferenceProfile(saved_query_id=_query().id)  # no centroids
    assert taste_score([1.0, 0.0], profile) == 0.0


def test_doc_text_joins_title_and_description() -> None:
    result = _result("Show")
    result = result.model_copy(update={"description": "blurb"})
    assert doc_text(result) == "Show\nblurb"


# --- _rerank ---------------------------------------------------------------


def test_parse_rerank_reads_order_and_reasons() -> None:
    order = parse_rerank(_ranking_reply(2, 1, 3), count=3)
    assert order == [(1, "reason 2"), (0, "reason 1"), (2, "reason 3")]


def test_parse_rerank_drops_out_of_range_and_duplicate_indices() -> None:
    reply = json.dumps({"ranking": [{"id": 9}, {"id": 1}, {"id": 1}, {"id": 0}]})
    assert parse_rerank(reply, count=2) == [(0, None)]


def test_parse_rerank_tolerates_junk() -> None:
    assert parse_rerank("not json", count=3) == []
    assert parse_rerank('```json\n{"ranking": [{"id": 1}]}\n```', count=3) == [(0, None)]


def test_build_rerank_prompt_carries_summary_and_candidates() -> None:
    results = [_result("Jazz Night"), _result("Punk Show")]
    messages = build_rerank_prompt(
        "be a reranker", results, summary="loves small venues", query=_query()
    )

    assert [m.role for m in messages] == ["system", "user"]
    assert messages[0].content == "be a reranker"
    assert "loves small venues" in messages[1].content
    assert "1. Jazz Night" in messages[1].content
    assert "2. Punk Show" in messages[1].content
    assert "jazz in berlin" in messages[1].content


# --- PreferenceRanker ------------------------------------------------------


def _ranker(embedder: FakeEmbedder, reranker: FakeReranker, **kw: int) -> PreferenceRanker:
    return PreferenceRanker(embedder, reranker, system_prompt="rerank", model="test-model", **kw)


async def test_empty_results_skips_work() -> None:
    embedder, reranker = FakeEmbedder({}), FakeReranker(_ranking_reply())
    ranked = await _ranker(embedder, reranker).rank(
        [], PreferenceProfile(saved_query_id=_query().id), query=_query()
    )
    assert ranked == []
    assert embedder.calls == 0
    assert reranker.calls == 0


async def test_rank_follows_llm_order_and_reuses_stored_embeddings() -> None:
    results = [
        _result("A", embedding=[1.0, 0.0]),
        _result("B", embedding=[0.0, 1.0]),
        _result("C", embedding=[1.0, 1.0]),
    ]
    profile = PreferenceProfile(saved_query_id=_query().id)  # cold: taste all 0, input order kept
    embedder = FakeEmbedder({})
    reranker = FakeReranker(_ranking_reply(3, 1, 2))  # C, A, B
    ranked = await _ranker(embedder, reranker).rank(results, profile, query=_query())

    assert [r.canonical_search_result_id for r in ranked] == [
        results[2].id,
        results[0].id,
        results[1].id,
    ]
    assert [r.rank for r in ranked] == [0, 1, 2]
    assert ranked[0].rationale == "reason 3"
    assert embedder.calls == 0  # every result carried a stored embedding
    assert reranker.calls == 1


async def test_rank_embeds_only_results_missing_an_embedding() -> None:
    results = [_result("A", embedding=[1.0, 0.0]), _result("B")]  # B has no embedding
    embedder = FakeEmbedder({"B": [0.0, 1.0]})
    reranker = FakeReranker(_ranking_reply(1, 2))
    await _ranker(embedder, reranker).rank(
        results, PreferenceProfile(saved_query_id=_query().id), query=_query()
    )

    assert embedder.calls == 1  # one batched call, only for the missing vector


async def test_rank_appends_candidates_the_model_omitted() -> None:
    results = [_result("A", embedding=[1.0, 0.0]), _result("B", embedding=[0.0, 1.0])]
    reranker = FakeReranker(_ranking_reply(2))  # only mentions B
    ranked = await _ranker(FakeEmbedder({}), reranker).rank(
        results, PreferenceProfile(saved_query_id=_query().id), query=_query()
    )

    assert [r.canonical_search_result_id for r in ranked] == [results[1].id, results[0].id]
    assert ranked[1].rationale is None  # the appended one carries no model reason


async def test_exploration_slot_promotes_uncertain_leftover() -> None:
    # Strong liked axis along [1,0]. High scorers crowd the top; a near-zero-score
    # item would never make the cut without an exploration slot.
    profile = PreferenceProfile(saved_query_id=_query().id, liked_centroid=[1.0, 0.0])
    liked = [_result(name, embedding=[1.0, 0.0]) for name in ("A", "B")]
    uncertain = _result("U", embedding=[0.0, 1.0])  # cosine 0 -> most uncertain
    results = [*liked, uncertain]
    reranker = FakeReranker(_ranking_reply(1, 2))  # ranks the two prefiltered likes
    ranked = await _ranker(FakeEmbedder({}), reranker, top_n=2, exploration_slots=1).rank(
        results, profile, query=_query()
    )

    assert len(ranked) == 2
    explore = [r for r in ranked if r.is_exploration]
    assert [r.canonical_search_result_id for r in explore] == [uncertain.id]
    assert explore[0].rationale is None


async def test_results_are_ranked_search_results() -> None:
    results = [_result("A", embedding=[1.0, 0.0])]
    ranked = await _ranker(FakeEmbedder({}), FakeReranker(_ranking_reply(1))).rank(
        results, PreferenceProfile(saved_query_id=_query().id), query=_query()
    )
    assert isinstance(ranked[0], RankedSearchResult)
