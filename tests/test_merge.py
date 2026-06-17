"""RRFMerger fuses per-query lists: items seen high in many lists win, and the
representative kept for a url is the one with the best (lowest) rank."""

from __future__ import annotations

from events_curator.enums import SearchEngineKind
from events_curator.merge import RRFMerger
from events_curator.models import RawSearchResult


def _ev(url: str, *, rank: int, title: str = "") -> RawSearchResult:
    return RawSearchResult(
        source_engine=SearchEngineKind.FRONTIER_NATIVE,
        url=url,
        title=title or url,
        rank=rank,
    )


def test_rrf_orders_by_fused_score() -> None:
    list1 = [_ev("a", rank=0), _ev("b", rank=1), _ev("c", rank=2)]
    list2 = [_ev("b", rank=0), _ev("a", rank=1)]
    list3 = [_ev("b", rank=0)]

    merged = RRFMerger(k=60).merge([list1, list2, list3])

    assert [e.url for e in merged] == ["b", "a", "c"]


def test_rrf_keeps_best_ranked_representative() -> None:
    high = _ev("a", rank=5, title="from-list-1")
    low = _ev("a", rank=1, title="from-list-2")

    merged = RRFMerger(k=60).merge([[high], [low]])

    assert len(merged) == 1
    assert merged[0].title == "from-list-2"


def test_rrf_fuses_on_rank_not_sequence_position() -> None:
    # `rank` disagrees with the slot in the handed-in list: the better-ranked
    # item must win regardless of the order the caller passes them in.
    ranked = [_ev("low", rank=9), _ev("high", rank=0)]

    merged = RRFMerger(k=60).merge([ranked])

    assert [e.url for e in merged] == ["high", "low"]
