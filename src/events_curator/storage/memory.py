"""Dependency-free in-memory `Storage`. Real default for tests and eval; the
SQLite + sqlite-vec adapter (extra `store`) replaces it in production with the
same surface. Nearest-neighbour is brute-force cosine — fine at corpus sizes a
single NUC sees, and exactly what the SQLite flat index does anyway."""

from __future__ import annotations

import math
from collections.abc import Sequence
from datetime import datetime

from events_curator.models import (
    CanonicalSearchResult,
    CanonicalSearchResultId,
    Feedback,
    PreferenceProfile,
    Provenance,
    RawSearchResult,
    RawSearchResultId,
    SavedQuery,
    SavedQueryId,
    User,
    UserId,
    Vector,
)
from events_curator.storage.protocols import (
    FeedbackStore,
    PreferenceStore,
    SavedQueryStore,
    SearchResultStore,
    Storage,
    UserStore,
)


def _cosine(a: Vector, b: Vector) -> float:
    if not a or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return 0.0 if na == 0.0 or nb == 0.0 else dot / (na * nb)


def _within_days(a: datetime | None, b: datetime | None, days: int) -> bool:
    if a is None or b is None:  # missing dates can't be blocked on; keep the pair
        return True
    return abs((a - b).days) <= days


def _city_matches(a: str | None, b: str | None) -> bool:
    if a is None or b is None:
        return True
    return a.strip().casefold() == b.strip().casefold()


class InMemoryUserStore(UserStore):
    def __init__(self, users: dict[UserId, User]) -> None:
        self._users = users

    async def get(self, user_id: UserId) -> User | None:
        return self._users.get(user_id)

    async def upsert(self, user: User) -> None:
        self._users[user.id] = user


class InMemorySavedQueryStore(SavedQueryStore):
    def __init__(self, queries: dict[SavedQueryId, SavedQuery]) -> None:
        self._queries = queries

    async def get(self, query_id: SavedQueryId) -> SavedQuery | None:
        return self._queries.get(query_id)

    async def list_for_user(self, user_id: UserId) -> list[SavedQuery]:
        return [q for q in self._queries.values() if q.user_id == user_id]

    async def list_scheduled(self) -> list[SavedQuery]:
        return [q for q in self._queries.values() if q.enabled and q.schedule_cron]

    async def upsert(self, query: SavedQuery) -> None:
        self._queries[query.id] = query


class InMemorySearchResultStore(SearchResultStore):
    def __init__(self) -> None:
        self._raw: dict[RawSearchResultId, RawSearchResult] = {}
        self._canonical: dict[CanonicalSearchResultId, CanonicalSearchResult] = {}
        self._provenance: dict[CanonicalSearchResultId, Provenance] = {}
        self._results: dict[SavedQueryId, list[CanonicalSearchResultId]] = {}

    async def add_raw(self, results: Sequence[RawSearchResult]) -> None:
        for ev in results:
            self._raw[ev.id] = ev

    async def upsert_canonical(self, result: CanonicalSearchResult, provenance: Provenance) -> None:
        self._canonical[result.id] = result
        self._provenance[result.id] = provenance

    async def get_canonical(
        self, search_result_id: CanonicalSearchResultId
    ) -> CanonicalSearchResult | None:
        return self._canonical.get(search_result_id)

    async def nearest(
        self,
        embedding: Vector,
        *,
        on_date: datetime | None,
        within_days: int,
        city: str | None,
        limit: int,
    ) -> list[tuple[CanonicalSearchResult, float]]:
        scored: list[tuple[CanonicalSearchResult, float]] = []
        for ev in self._canonical.values():
            if ev.embedding is None:
                continue
            if not _city_matches(city, ev.geo.city):
                continue
            if not _within_days(on_date, ev.starts_at, within_days):
                continue
            scored.append((ev, _cosine(embedding, ev.embedding)))
        scored.sort(key=lambda pair: pair[1], reverse=True)
        return scored[:limit]

    async def link_results(
        self, query_id: SavedQueryId, search_result_ids: Sequence[CanonicalSearchResultId]
    ) -> None:
        existing = self._results.setdefault(query_id, [])
        seen = set(existing)
        existing.extend(eid for eid in search_result_ids if eid not in seen)

    async def results_for_query(self, query_id: SavedQueryId) -> list[CanonicalSearchResult]:
        ids = self._results.get(query_id, [])
        return [self._canonical[i] for i in ids if i in self._canonical]


class InMemoryFeedbackStore(FeedbackStore):
    def __init__(self) -> None:
        self._by_query: dict[SavedQueryId, list[Feedback]] = {}

    async def add(self, feedback: Feedback) -> None:
        self._by_query.setdefault(feedback.saved_query_id, []).append(feedback)

    async def list_for_query(self, query_id: SavedQueryId) -> list[Feedback]:
        return list(self._by_query.get(query_id, []))


class InMemoryPreferenceStore(PreferenceStore):
    def __init__(self) -> None:
        self._profiles: dict[SavedQueryId, PreferenceProfile] = {}

    async def get(self, query_id: SavedQueryId) -> PreferenceProfile | None:
        return self._profiles.get(query_id)

    async def upsert(self, profile: PreferenceProfile) -> None:
        self._profiles[profile.saved_query_id] = profile


class InMemoryStorage(Storage):
    """Implements the `Storage` facade with plain dicts."""

    def __init__(self) -> None:
        self._users: dict[UserId, User] = {}
        self._queries: dict[SavedQueryId, SavedQuery] = {}
        self.users: UserStore = InMemoryUserStore(self._users)
        self.queries: SavedQueryStore = InMemorySavedQueryStore(self._queries)
        self.results: SearchResultStore = InMemorySearchResultStore()
        self.feedback: FeedbackStore = InMemoryFeedbackStore()
        self.preferences: PreferenceStore = InMemoryPreferenceStore()

    async def init(self) -> None:
        return None

    async def close(self) -> None:
        return None
