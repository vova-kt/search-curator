"""SQLite + sqlite-vec `Storage` adapter (extra `store`). Single file, vectors
co-located as float32 blobs, nearest-neighbour by a flat `vec_distance_cosine`
scan over the date+city block — identical results to `InMemoryStorage`, which is
the reference. See docs/storage.md."""

from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from datetime import UTC, datetime

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
from events_curator.storage._sqlite_support import (
    connect,
    load_canonical,
    load_profile,
    normalize_city,
    to_blob,
)
from events_curator.storage.protocols import (
    FeedbackStore,
    PreferenceStore,
    SavedQueryStore,
    SearchResultStore,
    Storage,
    UserStore,
)

_SECONDS_PER_DAY = 86_400


class SqliteUserStore(UserStore):
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    async def get(self, user_id: UserId) -> User | None:
        row = self._conn.execute("SELECT data FROM users WHERE id = ?", (user_id,)).fetchone()
        return User.model_validate_json(row["data"]) if row else None

    async def upsert(self, user: User) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO users (id, data) VALUES (?, ?)",
            (user.id, user.model_dump_json()),
        )
        self._conn.commit()


class SqliteSavedQueryStore(SavedQueryStore):
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    async def get(self, query_id: SavedQueryId) -> SavedQuery | None:
        row = self._conn.execute(
            "SELECT data FROM saved_queries WHERE id = ?", (query_id,)
        ).fetchone()
        return SavedQuery.model_validate_json(row["data"]) if row else None

    async def list_for_user(self, user_id: UserId) -> list[SavedQuery]:
        rows = self._conn.execute(
            "SELECT data FROM saved_queries WHERE user_id = ? ORDER BY rowid", (user_id,)
        ).fetchall()
        return [SavedQuery.model_validate_json(r["data"]) for r in rows]

    async def list_scheduled(self) -> list[SavedQuery]:
        rows = self._conn.execute(
            "SELECT data FROM saved_queries WHERE enabled = 1 AND has_cron = 1 ORDER BY rowid"
        ).fetchall()
        return [SavedQuery.model_validate_json(r["data"]) for r in rows]

    async def upsert(self, query: SavedQuery) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO saved_queries (id, user_id, enabled, has_cron, data) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                query.id,
                query.user_id,
                int(query.enabled),
                int(bool(query.schedule_cron)),
                query.model_dump_json(),
            ),
        )
        self._conn.commit()

    async def delete(self, query_id: SavedQueryId) -> None:
        self._conn.execute("DELETE FROM saved_queries WHERE id = ?", (query_id,))
        self._conn.execute("DELETE FROM query_results WHERE query_id = ?", (query_id,))
        self._conn.commit()


class SqliteSearchResultStore(SearchResultStore):
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    async def add_raw(self, results: Sequence[RawSearchResult]) -> None:
        self._conn.executemany(
            "INSERT OR REPLACE INTO raw_results (id, data) VALUES (?, ?)",
            [(r.id, r.model_dump_json()) for r in results],
        )
        self._conn.commit()

    async def upsert_canonical(self, result: CanonicalSearchResult, provenance: Provenance) -> None:
        embedding = to_blob(result.embedding) if result.embedding is not None else None
        starts_at_ts = result.starts_at.timestamp() if result.starts_at is not None else None
        self._conn.execute(
            "INSERT OR REPLACE INTO canonical_results "
            "(id, city, starts_at_ts, embedding, data) VALUES (?, ?, ?, ?, ?)",
            (
                result.id,
                normalize_city(result.geo.city),
                starts_at_ts,
                embedding,
                result.model_dump_json(exclude={"embedding"}),
            ),
        )
        self._conn.execute(
            "INSERT OR REPLACE INTO provenance (canonical_search_result_id, data) VALUES (?, ?)",
            (provenance.canonical_search_result_id, provenance.model_dump_json()),
        )
        self._conn.commit()

    async def get_canonical(
        self, search_result_id: CanonicalSearchResultId
    ) -> CanonicalSearchResult | None:
        row = self._conn.execute(
            "SELECT data, embedding FROM canonical_results WHERE id = ?", (search_result_id,)
        ).fetchone()
        return load_canonical(row["data"], row["embedding"]) if row else None

    async def nearest(
        self,
        embedding: Vector,
        *,
        on_date: datetime | None,
        within_days: int,
        city: str | None,
        limit: int,
    ) -> list[tuple[CanonicalSearchResult, float]]:
        rows = self._conn.execute(
            """
            SELECT data, embedding, vec_distance_cosine(embedding, :q) AS dist
            FROM canonical_results
            WHERE embedding IS NOT NULL
              AND (:city IS NULL OR city IS NULL OR city = :city)
              AND (:on_ts IS NULL OR starts_at_ts IS NULL
                   OR abs(starts_at_ts - :on_ts) <= :within_secs)
            ORDER BY dist ASC
            LIMIT :limit
            """,
            {
                "q": to_blob(embedding),
                "city": normalize_city(city),
                "on_ts": on_date.timestamp() if on_date is not None else None,
                "within_secs": within_days * _SECONDS_PER_DAY,
                "limit": limit,
            },
        ).fetchall()
        return [(load_canonical(r["data"], r["embedding"]), 1.0 - r["dist"]) for r in rows]

    async def link_results(
        self, query_id: SavedQueryId, search_result_ids: Sequence[CanonicalSearchResultId]
    ) -> None:
        self._conn.executemany(
            "INSERT OR IGNORE INTO query_results (query_id, canonical_search_result_id) "
            "VALUES (?, ?)",
            [(query_id, sid) for sid in search_result_ids],
        )
        self._conn.commit()

    async def results_for_query(self, query_id: SavedQueryId) -> list[CanonicalSearchResult]:
        rows = self._conn.execute(
            "SELECT c.data, c.embedding FROM query_results q "
            "JOIN canonical_results c ON c.id = q.canonical_search_result_id "
            "WHERE q.query_id = ? ORDER BY q.seq",
            (query_id,),
        ).fetchall()
        return [load_canonical(r["data"], r["embedding"]) for r in rows]

    async def mark_shown(
        self, user_id: UserId, search_result_ids: Sequence[CanonicalSearchResultId]
    ) -> None:
        now = datetime.now(tz=UTC).timestamp()
        self._conn.executemany(
            "INSERT OR IGNORE INTO shown_results "
            "(user_id, canonical_search_result_id, shown_at) VALUES (?, ?, ?)",
            [(user_id, sid, now) for sid in search_result_ids],
        )
        self._conn.commit()

    async def shown_ids_for_user(self, user_id: UserId) -> set[CanonicalSearchResultId]:
        rows = self._conn.execute(
            "SELECT canonical_search_result_id FROM shown_results WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        return {CanonicalSearchResultId(r["canonical_search_result_id"]) for r in rows}


class SqliteFeedbackStore(FeedbackStore):
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    async def add(self, feedback: Feedback) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO feedback (id, saved_query_id, data) VALUES (?, ?, ?)",
            (feedback.id, feedback.saved_query_id, feedback.model_dump_json()),
        )
        self._conn.commit()

    async def list_for_query(self, query_id: SavedQueryId) -> list[Feedback]:
        rows = self._conn.execute(
            "SELECT data FROM feedback WHERE saved_query_id = ? ORDER BY rowid", (query_id,)
        ).fetchall()
        return [Feedback.model_validate_json(r["data"]) for r in rows]


class SqlitePreferenceStore(PreferenceStore):
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    async def get(self, query_id: SavedQueryId) -> PreferenceProfile | None:
        row = self._conn.execute(
            "SELECT data, liked_centroid, disliked_centroid FROM preferences "
            "WHERE saved_query_id = ?",
            (query_id,),
        ).fetchone()
        if row is None:
            return None
        return load_profile(row["data"], row["liked_centroid"], row["disliked_centroid"])

    async def upsert(self, profile: PreferenceProfile) -> None:
        liked = to_blob(profile.liked_centroid) if profile.liked_centroid is not None else None
        disliked = (
            to_blob(profile.disliked_centroid) if profile.disliked_centroid is not None else None
        )
        self._conn.execute(
            "INSERT OR REPLACE INTO preferences "
            "(saved_query_id, liked_centroid, disliked_centroid, data) VALUES (?, ?, ?, ?)",
            (
                profile.saved_query_id,
                liked,
                disliked,
                profile.model_dump_json(exclude={"liked_centroid", "disliked_centroid"}),
            ),
        )
        self._conn.commit()


class SqliteStorage(Storage):
    """Implements the `Storage` facade over one SQLite file. Call `init()` before
    use to open the connection and apply the schema; `close()` releases it."""

    users: UserStore
    queries: SavedQueryStore
    results: SearchResultStore
    feedback: FeedbackStore
    preferences: PreferenceStore

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._conn: sqlite3.Connection | None = None

    async def init(self) -> None:
        conn = connect(self._db_path)
        self._conn = conn
        self.users = SqliteUserStore(conn)
        self.queries = SqliteSavedQueryStore(conn)
        self.results = SqliteSearchResultStore(conn)
        self.feedback = SqliteFeedbackStore(conn)
        self.preferences = SqlitePreferenceStore(conn)

    async def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None
