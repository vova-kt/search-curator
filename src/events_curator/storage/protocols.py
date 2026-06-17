"""Storage ports. Split into one small store per aggregate, behind a `Storage`
facade. The production adapter is SQLite + sqlite-vec (single file, co-located
vectors); `InMemoryStorage` is the dependency-free default for tests and eval."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Protocol

from events_curator.models import (
    CanonicalSearchResult,
    CanonicalSearchResultId,
    Feedback,
    PreferenceProfile,
    Provenance,
    RawSearchResult,
    SavedQuery,
    SavedQueryId,
    User,
    UserId,
    Vector,
)


class UserStore(Protocol):
    async def get(self, user_id: UserId) -> User | None: ...
    async def upsert(self, user: User) -> None: ...


class SavedQueryStore(Protocol):
    async def get(self, query_id: SavedQueryId) -> SavedQuery | None: ...
    async def list_for_user(self, user_id: UserId) -> list[SavedQuery]: ...
    async def list_scheduled(self) -> list[SavedQuery]: ...  # enabled + has a cron
    async def upsert(self, query: SavedQuery) -> None: ...


class SearchResultStore(Protocol):
    async def add_raw(self, results: Sequence[RawSearchResult]) -> None: ...
    async def upsert_canonical(
        self, result: CanonicalSearchResult, provenance: Provenance
    ) -> None: ...
    async def get_canonical(
        self, search_result_id: CanonicalSearchResultId
    ) -> CanonicalSearchResult | None: ...
    async def nearest(
        self,
        embedding: Vector,
        *,
        on_date: datetime | None,
        within_days: int,
        city: str | None,
        limit: int,
    ) -> list[tuple[CanonicalSearchResult, float]]: ...
    async def link_results(
        self, query_id: SavedQueryId, search_result_ids: Sequence[CanonicalSearchResultId]
    ) -> None: ...
    async def results_for_query(self, query_id: SavedQueryId) -> list[CanonicalSearchResult]: ...


class FeedbackStore(Protocol):
    async def add(self, feedback: Feedback) -> None: ...
    async def list_for_query(self, query_id: SavedQueryId) -> list[Feedback]: ...


class PreferenceStore(Protocol):
    async def get(self, query_id: SavedQueryId) -> PreferenceProfile | None: ...
    async def upsert(self, profile: PreferenceProfile) -> None: ...


class Storage(Protocol):
    users: UserStore
    queries: SavedQueryStore
    results: SearchResultStore
    feedback: FeedbackStore
    preferences: PreferenceStore

    async def init(self) -> None: ...  # create schema / open connection
    async def close(self) -> None: ...
