"""Storage module door. Protocols + the in-memory default implementation."""

from __future__ import annotations

from events_curator.storage.memory import InMemoryStorage
from events_curator.storage.protocols import (
    FeedbackStore,
    PreferenceStore,
    SavedQueryStore,
    SearchResultStore,
    Storage,
    UserStore,
)

__all__ = [
    "FeedbackStore",
    "InMemoryStorage",
    "PreferenceStore",
    "SavedQueryStore",
    "SearchResultStore",
    "Storage",
    "UserStore",
]
