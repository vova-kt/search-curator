"""Storage module door. Protocols, the in-memory default, and the SQLite adapter.

`SqliteStorage` is re-exported lazily: importing this door never pulls in the
optional `store` extra (sqlite-vec). `from events_curator.storage import
SqliteStorage` loads it on demand and raises a clear ImportError if the extra is
not installed.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from events_curator.storage.memory import InMemoryStorage
from events_curator.storage.protocols import (
    FeedbackStore,
    PreferenceStore,
    SavedQueryStore,
    SearchResultStore,
    Storage,
    UserStore,
)

if TYPE_CHECKING:
    from events_curator.storage.sqlite import SqliteStorage

__all__ = [
    "FeedbackStore",
    "InMemoryStorage",
    "PreferenceStore",
    "SavedQueryStore",
    "SearchResultStore",
    "SqliteStorage",
    "Storage",
    "UserStore",
]


def __getattr__(name: str) -> object:
    if name == "SqliteStorage":
        from events_curator.storage.sqlite import SqliteStorage  # noqa: PLC0415

        return SqliteStorage
    raise AttributeError(f"module {__name__!r} has no attribute {name}")
