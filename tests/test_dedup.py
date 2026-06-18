"""ThresholdDeduper reconciles candidates against the stored corpus: exact-URL and
high-similarity matches merge into a golden record, the ambiguous band defers to an
LLM judge, and everything else is inserted new. Plus the dependency-free helpers:
MinHash similarity, the judge prompt/parse, and golden-record survivorship."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

from events_curator.dedup import ThresholdDeduper
from events_curator.dedup._golden import doc_text, merge_into, new_golden
from events_curator.dedup._judge import build_judge_prompt, parse_judge_verdict
from events_curator.dedup._match import (
    combined_similarity,
    jaccard,
    text_signature,
)
from events_curator.enums import DedupDecision, SearchEngineKind
from events_curator.llm import ChatMessage
from events_curator.models import Geo, RawSearchResult, Vector
from events_curator.storage import InMemoryStorage, SearchResultStore

DATE = datetime(2026, 7, 1, 20, tzinfo=UTC)


class FakeEmbedder:
    """Maps a record's text to a preset vector, keyed by the title (first line of
    the doc text), and counts how many times it was called."""

    def __init__(self, by_title: dict[str, Vector]) -> None:
        self._by_title = by_title
        self.calls = 0

    async def embed(self, texts: Sequence[str]) -> list[Vector]:
        self.calls += 1
        return [self._by_title[text.split("\n", 1)[0]] for text in texts]


class FakeJudge:
    def __init__(self, verdict: str) -> None:
        self._verdict = verdict
        self.calls: list[Sequence[ChatMessage]] = []

    async def complete(
        self, messages: Sequence[ChatMessage], *, model: str, temperature: float = 0.0
    ) -> str:
        del model, temperature
        self.calls.append(messages)
        return self._verdict


def _cand(
    title: str,
    *,
    url: str | None = None,
    city: str | None = "Berlin",
    description: str = "",
    attributes: dict[str, str] | None = None,
    starts_at: datetime | None = DATE,
) -> RawSearchResult:
    return RawSearchResult(
        source_engine=SearchEngineKind.FRONTIER_NATIVE,
        url=url or f"https://e.com/{title.replace(' ', '-')}",
        title=title,
        description=description,
        starts_at=starts_at,
        geo=Geo(city=city),
        attributes=attributes or {},
    )


def _deduper(embedder: FakeEmbedder, judge: FakeJudge | None = None) -> ThresholdDeduper:
    return ThresholdDeduper(
        embedder,
        judge or FakeJudge("no"),
        system_prompt="judge",
        model="test-model",
        auto_merge_threshold=0.88,
        tiebreak_low_threshold=0.75,
        block_window_days=1,
        block_limit=10,
    )


def _store() -> SearchResultStore:
    return InMemoryStorage().results


# --- reconcile -------------------------------------------------------------


async def test_empty_candidates_skips_embedding() -> None:
    embedder = FakeEmbedder({})
    outcomes = await _deduper(embedder).reconcile([], _store())
    assert outcomes == []
    assert embedder.calls == 0


async def test_insert_new_into_empty_corpus() -> None:
    store = _store()
    embedder = FakeEmbedder({"Jazz Night": [1.0, 0.0]})
    [outcome] = await _deduper(embedder).reconcile([_cand("Jazz Night")], store)

    assert outcome.decision is DedupDecision.INSERT_NEW
    assert outcome.canonical_search_result_id is not None
    assert embedder.calls == 1
    canonical = await store.get_canonical(outcome.canonical_search_result_id)
    assert canonical is not None
    assert canonical.title == "Jazz Night"


async def test_embeds_all_candidates_in_one_batch() -> None:
    store = _store()
    embedder = FakeEmbedder({"Opera": [1.0, 0.0], "Punk": [0.0, 1.0], "Folk": [-1.0, 0.0]})
    candidates = [
        _cand("Opera", city="Berlin"),
        _cand("Punk", city="Paris"),
        _cand("Folk", city="Rome"),
    ]
    outcomes = await _deduper(embedder).reconcile(candidates, store)

    assert embedder.calls == 1  # rule 5: one batched embed, not one per candidate
    assert all(o.decision is DedupDecision.INSERT_NEW for o in outcomes)


async def test_exact_url_merges_within_run() -> None:
    store = _store()
    embedder = FakeEmbedder({"A": [1.0, 0.0], "B": [0.0, 1.0]})
    first = _cand("A", url="https://e.com/show")
    second = _cand("B", url="https://e.com/show", description="late set")
    outcomes = await _deduper(embedder).reconcile([first, second], store)

    assert [o.decision for o in outcomes] == [
        DedupDecision.INSERT_NEW,
        DedupDecision.AUTO_MERGE,
    ]
    assert outcomes[1].similarity == 1.0
    assert outcomes[0].canonical_search_result_id == outcomes[1].canonical_search_result_id
    landed = outcomes[1].canonical_search_result_id
    assert landed is not None
    canonical = await store.get_canonical(landed)
    assert canonical is not None
    assert canonical.title == "A"  # first-non-empty survivorship keeps the first
    assert canonical.description == "late set"  # empty field filled from the second
    assert len(canonical.source_search_result_ids) == 2


async def test_auto_merge_by_cosine() -> None:
    store = _store()
    embedder = FakeEmbedder({"Jazz Night Club": [1.0, 0.0], "Jazz Evening Club": [1.0, 0.0]})
    first = _cand("Jazz Night Club", url="https://e.com/1")
    second = _cand("Jazz Evening Club", url="https://e.com/2")
    outcomes = await _deduper(embedder).reconcile([first, second], store)

    assert outcomes[1].decision is DedupDecision.AUTO_MERGE
    assert outcomes[0].canonical_search_result_id == outcomes[1].canonical_search_result_id


async def test_tiebreak_band_judge_merges() -> None:
    store = _store()
    embedder = FakeEmbedder({"Morning Trail Race": [1.0, 0.0], "Sunrise Mountain Run": [0.8, 0.6]})
    judge = FakeJudge("yes")
    first = _cand("Morning Trail Race", url="https://e.com/1")
    second = _cand("Sunrise Mountain Run", url="https://e.com/2")
    outcomes = await _deduper(embedder, judge).reconcile([first, second], store)

    assert outcomes[1].decision is DedupDecision.TIEBREAK
    assert outcomes[0].canonical_search_result_id == outcomes[1].canonical_search_result_id
    assert len(judge.calls) == 1


async def test_tiebreak_band_judge_rejects() -> None:
    store = _store()
    embedder = FakeEmbedder({"Morning Trail Race": [1.0, 0.0], "Sunrise Mountain Run": [0.8, 0.6]})
    judge = FakeJudge("no")
    first = _cand("Morning Trail Race", url="https://e.com/1")
    second = _cand("Sunrise Mountain Run", url="https://e.com/2")
    outcomes = await _deduper(embedder, judge).reconcile([first, second], store)

    assert outcomes[1].decision is DedupDecision.TIEBREAK
    assert outcomes[1].canonical_search_result_id != outcomes[0].canonical_search_result_id
    assert len(judge.calls) == 1


async def test_below_threshold_inserts_new_with_match_similarity() -> None:
    store = _store()
    embedder = FakeEmbedder({"Opera Gala": [1.0, 0.0], "Punk Basement": [0.0, 1.0]})
    judge = FakeJudge("yes")  # would merge if reached; it must not be
    first = _cand("Opera Gala", url="https://e.com/1")
    second = _cand("Punk Basement", url="https://e.com/2")
    outcomes = await _deduper(embedder, judge).reconcile([first, second], store)

    assert outcomes[1].decision is DedupDecision.INSERT_NEW
    assert outcomes[1].canonical_search_result_id != outcomes[0].canonical_search_result_id
    assert outcomes[1].similarity == 0.0  # a match existed in-block but scored below
    assert judge.calls == []


async def test_different_city_blocks_out_match() -> None:
    store = _store()
    embedder = FakeEmbedder({"Gala": [1.0, 0.0], "Gala Encore": [1.0, 0.0]})
    first = _cand("Gala", city="Berlin")
    second = _cand("Gala Encore", city="Paris")  # identical vector, different block
    outcomes = await _deduper(embedder).reconcile([first, second], store)

    assert outcomes[1].decision is DedupDecision.INSERT_NEW
    assert outcomes[1].similarity is None  # nearest returned nothing to score


# --- _match ----------------------------------------------------------------


def test_jaccard_identical_text_is_one() -> None:
    sig = text_signature("morning trail race in the alps")
    assert jaccard(sig, sig) == 1.0


def test_jaccard_disjoint_text_is_near_zero() -> None:
    a = text_signature("opera gala downtown hall")
    b = text_signature("punk basement warehouse show")
    assert jaccard(a, b) <= 0.2


def test_jaccard_empty_signature_is_zero() -> None:
    assert jaccard(text_signature(""), text_signature("anything")) == 0.0


def test_combined_similarity_takes_the_stronger_signal() -> None:
    assert combined_similarity(0.3, 0.9) == 0.9
    assert combined_similarity(0.9, 0.1) == 0.9


# --- _judge ----------------------------------------------------------------


def test_parse_judge_verdict() -> None:
    assert parse_judge_verdict("yes") is True
    assert parse_judge_verdict("  YES, same event\n") is True
    assert parse_judge_verdict("same") is True
    assert parse_judge_verdict("no") is False
    assert parse_judge_verdict("") is False
    assert parse_judge_verdict("they differ") is False


def test_build_judge_prompt_carries_both_records() -> None:
    candidate = _cand("Trail Race", description="10k")
    canonical, _ = new_golden(_cand("Mountain Run"), [1.0, 0.0])
    messages = build_judge_prompt("be a judge", candidate, canonical)

    assert [m.role for m in messages] == ["system", "user"]
    assert messages[0].content == "be a judge"
    assert "Trail Race" in messages[1].content
    assert "Mountain Run" in messages[1].content


# --- _golden ---------------------------------------------------------------


def test_doc_text_joins_title_and_description() -> None:
    assert doc_text(_cand("Title", description="blurb")) == "Title\nblurb"


def test_new_golden_attributes_populated_fields() -> None:
    candidate = _cand("Show", description="blurb", attributes={"genre": "jazz"})
    canonical, provenance = new_golden(candidate, [1.0, 0.0])

    assert canonical.embedding == [1.0, 0.0]
    assert canonical.source_search_result_ids == [candidate.id]
    assert provenance.field_sources["title"] == candidate.id
    assert provenance.field_sources["attributes"] == candidate.id
    assert provenance.field_sources["geo"] == candidate.id


def test_merge_into_fills_gaps_merges_attributes_and_records_sources() -> None:
    base = _cand("Show", description="", attributes={"genre": "jazz"})
    canonical, provenance = new_golden(base, [1.0, 0.0])
    extra = _cand("Show", description="late set", attributes={"genre": "rock", "venue": "A"})

    merged, merged_prov = merge_into(canonical, provenance, extra)

    assert merged.title == "Show"  # kept
    assert merged.description == "late set"  # filled
    # key-wise fill: base keeps its value for an existing key, new keys are added.
    assert merged.attributes == {"genre": "jazz", "venue": "A"}
    assert merged.source_search_result_ids == [base.id, extra.id]
    assert merged_prov.field_sources["description"] == extra.id
    # "title" was already set by the base source; the merge must not steal it.
    assert merged_prov.field_sources["title"] == base.id


def test_merge_into_keeps_existing_non_empty_value() -> None:
    base = _cand("Original Title", description="full")
    canonical, provenance = new_golden(base, [1.0, 0.0])
    other = _cand("Different Title", description="other")

    merged, _ = merge_into(canonical, provenance, other)

    assert merged.title == "Original Title"
    assert merged.description == "full"
