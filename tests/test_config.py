"""Config loads defaults and reads nested env overrides via the ``__`` delimiter."""

from __future__ import annotations

import pytest

from events_curator.config import AppConfig


def test_nested_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEDUP__AUTO_MERGE_THRESHOLD", "0.91")
    monkeypatch.setenv("STORAGE__DB_PATH", "/data/events.db")
    config = AppConfig()
    assert config.dedup.auto_merge_threshold == 0.91
    assert config.storage.db_path == "/data/events.db"
