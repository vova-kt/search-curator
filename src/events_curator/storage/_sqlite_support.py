"""Internals shared by the SQLite stores: connection setup (with the sqlite-vec
extension loaded), float32 blob (de)serialization, the schema DDL, and the
JSON<->model helpers. Private to the storage module."""

from __future__ import annotations

import sqlite3
import struct

import sqlite_vec

from events_curator.models import (
    CanonicalSearchResult,
    PreferenceProfile,
    Vector,
)


def connect(db_path: str) -> sqlite3.Connection:
    """Open a connection with sqlite-vec loaded and the schema applied."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.enable_load_extension(True)
    conn.load_extension(sqlite_vec.loadable_path())
    conn.enable_load_extension(False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def to_blob(vector: Vector) -> bytes:
    """Serialize a vector to the little-endian float32 layout sqlite-vec reads."""
    return struct.pack(f"<{len(vector)}f", *vector)


def from_blob(blob: bytes) -> Vector:
    return list(struct.unpack(f"<{len(blob) // 4}f", blob))


def normalize_city(city: str | None) -> str | None:
    """Match the in-memory store's blocking key: trimmed + case-folded."""
    return city.strip().casefold() if city is not None else None


def load_canonical(data: str, embedding: bytes | None) -> CanonicalSearchResult:
    result = CanonicalSearchResult.model_validate_json(data)
    if embedding is not None:
        result.embedding = from_blob(embedding)
    return result


def load_profile(data: str, liked: bytes | None, disliked: bytes | None) -> PreferenceProfile:
    profile = PreferenceProfile.model_validate_json(data)
    if liked is not None:
        profile.liked_centroid = from_blob(liked)
    if disliked is not None:
        profile.disliked_centroid = from_blob(disliked)
    return profile


# Each aggregate keeps its full pydantic model as a JSON `data` column for
# faithful round-tripping; columns alongside it exist only to filter/sort
# (ownership, schedule, the date+city dedup block) or to hold vectors as blobs
# (excluded from `data` to avoid storing them twice). No migrations pre-1.0 —
# reset the file when the schema changes.
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id   TEXT PRIMARY KEY,
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_queries (
    id       TEXT PRIMARY KEY,
    user_id  TEXT NOT NULL,
    enabled  INTEGER NOT NULL,
    has_cron INTEGER NOT NULL,
    data     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_queries_user ON saved_queries(user_id);

CREATE TABLE IF NOT EXISTS raw_results (
    id   TEXT PRIMARY KEY,
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS canonical_results (
    id           TEXT PRIMARY KEY,
    city         TEXT,
    starts_at_ts REAL,
    embedding    BLOB,
    data         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provenance (
    canonical_search_result_id TEXT PRIMARY KEY,
    data                       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS query_results (
    seq                        INTEGER PRIMARY KEY AUTOINCREMENT,
    query_id                   TEXT NOT NULL,
    canonical_search_result_id TEXT NOT NULL,
    UNIQUE(query_id, canonical_search_result_id)
);
CREATE INDEX IF NOT EXISTS idx_query_results_query ON query_results(query_id);

CREATE TABLE IF NOT EXISTS feedback (
    id             TEXT PRIMARY KEY,
    saved_query_id TEXT NOT NULL,
    data           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_query ON feedback(saved_query_id);

CREATE TABLE IF NOT EXISTS preferences (
    saved_query_id    TEXT PRIMARY KEY,
    liked_centroid    BLOB,
    disliked_centroid BLOB,
    data              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shown_results (
    user_id                    TEXT NOT NULL,
    canonical_search_result_id TEXT NOT NULL,
    shown_at                   REAL NOT NULL,
    PRIMARY KEY (user_id, canonical_search_result_id)
);
"""
