"""InMemoryStorage: nearest() blocks on city and date window before scoring by
cosine, and link_results de-duplicates across calls."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from events_curator.models import (
    CanonicalSearchResult,
    CanonicalSearchResultId,
    Geo,
    Provenance,
    Vector,
    new_saved_query_id,
)
from events_curator.storage import InMemoryStorage

_BASE = datetime(2026, 6, 17, tzinfo=UTC)


def _canon(
    cid: str, *, embedding: Vector, city: str | None, days_out: int = 0
) -> CanonicalSearchResult:
    return CanonicalSearchResult(
        id=CanonicalSearchResultId(cid),
        url=f"https://e/{cid}",
        title=cid,
        geo=Geo(city=city),
        starts_at=_BASE + timedelta(days=days_out),
        embedding=embedding,
    )


async def _store_with(results: list[CanonicalSearchResult]) -> InMemoryStorage:
    storage = InMemoryStorage()
    for ev in results:
        await storage.results.upsert_canonical(ev, Provenance(canonical_search_result_id=ev.id))
    return storage


async def test_nearest_filters_by_city() -> None:
    storage = await _store_with(
        [
            _canon("berlin", embedding=[1.0, 0.0], city="Berlin"),
            _canon("paris", embedding=[1.0, 0.0], city="Paris"),
        ]
    )
    hits = await storage.results.nearest(
        [1.0, 0.0], on_date=None, within_days=1, city="berlin", limit=10
    )
    assert [c.id for c, _ in hits] == [CanonicalSearchResultId("berlin")]


async def test_nearest_filters_by_date_window() -> None:
    storage = await _store_with(
        [
            _canon("near", embedding=[1.0, 0.0], city=None, days_out=0),
            _canon("far", embedding=[1.0, 0.0], city=None, days_out=5),
        ]
    )
    hits = await storage.results.nearest(
        [1.0, 0.0], on_date=_BASE, within_days=1, city=None, limit=10
    )
    assert [c.id for c, _ in hits] == [CanonicalSearchResultId("near")]


async def test_nearest_sorts_by_cosine_descending() -> None:
    storage = await _store_with(
        [
            _canon("aligned", embedding=[1.0, 0.0], city=None),
            _canon("orthogonal", embedding=[0.0, 1.0], city=None),
        ]
    )
    hits = await storage.results.nearest(
        [1.0, 0.0], on_date=None, within_days=1, city=None, limit=10
    )
    assert [c.id for c, _ in hits] == [
        CanonicalSearchResultId("aligned"),
        CanonicalSearchResultId("orthogonal"),
    ]
    assert hits[0][1] > hits[1][1]


async def test_link_results_dedups_across_calls() -> None:
    ev = _canon("x", embedding=[1.0, 0.0], city=None)
    storage = await _store_with([ev])
    qid = new_saved_query_id()
    await storage.results.link_results(qid, [ev.id])
    await storage.results.link_results(qid, [ev.id])  # repeat
    results = await storage.results.results_for_query(qid)
    assert [c.id for c in results] == [ev.id]
