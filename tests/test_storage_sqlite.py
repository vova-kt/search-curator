"""SqliteStorage must reproduce InMemoryStorage's behaviour (the reference): the
date+city block runs before the flat cosine scan in nearest(), link_results
de-duplicates, and every aggregate round-trips faithfully — including across a
close()/reopen, since persistence is the whole point of the adapter."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

pytest.importorskip("sqlite_vec")  # the `store` extra; skip the suite without it

from events_curator.enums import FeedbackKind
from events_curator.models import (
    CanonicalSearchResult,
    CanonicalSearchResultId,
    Feedback,
    Geo,
    PreferenceProfile,
    Provenance,
    SavedQuery,
    TimeWindow,
    User,
    UserId,
    Vector,
    new_saved_query_id,
)
from events_curator.storage.sqlite import SqliteStorage

_BASE = datetime(2026, 6, 17, tzinfo=UTC)


async def _open(tmp_path: Path) -> SqliteStorage:
    storage = SqliteStorage(str(tmp_path / "events.db"))
    await storage.init()
    return storage


def _canon(
    cid: str, *, embedding: Vector | None = None, city: str | None = None, days_out: int = 0
) -> CanonicalSearchResult:
    return CanonicalSearchResult(
        id=CanonicalSearchResultId(cid),
        url=f"https://e/{cid}",
        title=cid,
        geo=Geo(city=city),
        starts_at=_BASE + timedelta(days=days_out),
        embedding=embedding,
    )


async def _store_canon(storage: SqliteStorage, results: list[CanonicalSearchResult]) -> None:
    for ev in results:
        await storage.results.upsert_canonical(ev, Provenance(canonical_search_result_id=ev.id))


async def test_nearest_filters_by_city(tmp_path: Path) -> None:
    storage = await _open(tmp_path)
    await _store_canon(
        storage,
        [
            _canon("berlin", embedding=[1.0, 0.0], city="Berlin"),
            _canon("paris", embedding=[1.0, 0.0], city="Paris"),
        ],
    )
    hits = await storage.results.nearest(
        [1.0, 0.0], on_date=None, within_days=1, city="berlin", limit=10
    )
    assert [c.id for c, _ in hits] == [CanonicalSearchResultId("berlin")]


async def test_nearest_filters_by_date_window(tmp_path: Path) -> None:
    storage = await _open(tmp_path)
    await _store_canon(
        storage,
        [
            _canon("near", embedding=[1.0, 0.0], days_out=0),
            _canon("far", embedding=[1.0, 0.0], days_out=5),
        ],
    )
    hits = await storage.results.nearest(
        [1.0, 0.0], on_date=_BASE, within_days=1, city=None, limit=10
    )
    assert [c.id for c, _ in hits] == [CanonicalSearchResultId("near")]


async def test_nearest_sorts_by_cosine_descending(tmp_path: Path) -> None:
    storage = await _open(tmp_path)
    await _store_canon(
        storage,
        [
            _canon("aligned", embedding=[1.0, 0.0]),
            _canon("orthogonal", embedding=[0.0, 1.0]),
        ],
    )
    hits = await storage.results.nearest(
        [1.0, 0.0], on_date=None, within_days=1, city=None, limit=10
    )
    assert [c.id for c, _ in hits] == [
        CanonicalSearchResultId("aligned"),
        CanonicalSearchResultId("orthogonal"),
    ]
    assert hits[0][1] == pytest.approx(1.0)
    assert hits[0][1] > hits[1][1]


async def test_nearest_skips_results_without_embedding(tmp_path: Path) -> None:
    storage = await _open(tmp_path)
    await _store_canon(
        storage,
        [_canon("with", embedding=[1.0, 0.0]), _canon("without", embedding=None)],
    )
    hits = await storage.results.nearest(
        [1.0, 0.0], on_date=None, within_days=1, city=None, limit=10
    )
    assert [c.id for c, _ in hits] == [CanonicalSearchResultId("with")]


async def test_link_results_dedups_across_calls(tmp_path: Path) -> None:
    storage = await _open(tmp_path)
    ev = _canon("x", embedding=[1.0, 0.0])
    await _store_canon(storage, [ev])
    qid = new_saved_query_id()
    await storage.results.link_results(qid, [ev.id])
    await storage.results.link_results(qid, [ev.id])
    results = await storage.results.results_for_query(qid)
    assert [c.id for c in results] == [ev.id]


async def test_canonical_round_trips_with_embedding(tmp_path: Path) -> None:
    storage = await _open(tmp_path)
    ev = _canon("e", embedding=[0.5, 0.25], city="Lyon")
    await _store_canon(storage, [ev])
    fetched = await storage.results.get_canonical(ev.id)
    assert fetched is not None
    assert fetched.embedding == [0.5, 0.25]
    assert fetched.geo.city == "Lyon"
    assert fetched.url == ev.url


async def test_saved_query_listing_filters(tmp_path: Path) -> None:
    storage = await _open(tmp_path)
    alice, bob = UserId("alice"), UserId("bob")
    scheduled = SavedQuery(user_id=alice, text="jazz", schedule_cron="0 9 * * *")
    manual = SavedQuery(user_id=alice, text="trail races")
    disabled = SavedQuery(user_id=alice, text="off", schedule_cron="0 9 * * *", enabled=False)
    others = SavedQuery(user_id=bob, text="papers", schedule_cron="0 9 * * *")
    for q in (scheduled, manual, disabled, others):
        await storage.queries.upsert(q)

    assert {q.id for q in await storage.queries.list_for_user(alice)} == {
        scheduled.id,
        manual.id,
        disabled.id,
    }
    assert {q.id for q in await storage.queries.list_scheduled()} == {scheduled.id, others.id}


async def test_feedback_round_trips_in_order(tmp_path: Path) -> None:
    storage = await _open(tmp_path)
    qid = new_saved_query_id()
    cid = CanonicalSearchResultId("c")
    first = Feedback(saved_query_id=qid, canonical_search_result_id=cid, kind=FeedbackKind.LIKE)
    second = Feedback(
        saved_query_id=qid,
        canonical_search_result_id=cid,
        kind=FeedbackKind.DISLIKE,
        reason="too far",
    )
    await storage.feedback.add(first)
    await storage.feedback.add(second)
    stored = await storage.feedback.list_for_query(qid)
    assert [f.id for f in stored] == [first.id, second.id]
    assert stored[1].reason == "too far"


async def test_preference_round_trips_with_centroids(tmp_path: Path) -> None:
    storage = await _open(tmp_path)
    qid = new_saved_query_id()
    profile = PreferenceProfile(
        saved_query_id=qid,
        nl_summary="likes intimate venues",
        liked_centroid=[0.5, 0.25],
        like_count=3,
    )
    await storage.preferences.upsert(profile)
    fetched = await storage.preferences.get(qid)
    assert fetched is not None
    assert fetched.nl_summary == "likes intimate venues"
    assert fetched.liked_centroid == [0.5, 0.25]
    assert fetched.disliked_centroid is None
    assert fetched.like_count == 3


async def test_shown_ledger_round_trips_idempotently(tmp_path: Path) -> None:
    storage = await _open(tmp_path)
    user = UserId("tg:1")
    a, b = CanonicalSearchResultId("a"), CanonicalSearchResultId("b")
    await storage.results.mark_shown(user, [a, b])
    await storage.results.mark_shown(user, [b])  # idempotent re-mark
    assert await storage.results.shown_ids_for_user(user) == {a, b}
    assert await storage.results.shown_ids_for_user(UserId("tg:2")) == set()
    await storage.close()


async def test_delete_query_removes_it_and_its_links(tmp_path: Path) -> None:
    storage = await _open(tmp_path)
    ev = _canon("e", embedding=[1.0, 0.0])
    query = SavedQuery(user_id=UserId("u"), text="jazz")
    await storage.queries.upsert(query)
    await _store_canon(storage, [ev])
    await storage.results.link_results(query.id, [ev.id])

    await storage.queries.delete(query.id)

    assert await storage.queries.get(query.id) is None
    assert await storage.results.results_for_query(query.id) == []
    await storage.close()


async def test_data_survives_close_and_reopen(tmp_path: Path) -> None:
    storage = await _open(tmp_path)
    user = User(id=UserId("u"), display_name="Op")
    query = SavedQuery(id=new_saved_query_id(), user_id=user.id, text="jazz", window=TimeWindow())
    ev = _canon("e", embedding=[1.0, 0.0], city="Berlin")
    await storage.users.upsert(user)
    await storage.queries.upsert(query)
    await _store_canon(storage, [ev])
    await storage.results.link_results(query.id, [ev.id])
    await storage.close()

    reopened = await _open(tmp_path)
    assert (await reopened.users.get(user.id)) == user
    assert (await reopened.queries.get(query.id)) == query
    linked = await reopened.results.results_for_query(query.id)
    assert [c.id for c in linked] == [ev.id]
    assert linked[0].embedding == [1.0, 0.0]
    await reopened.close()
