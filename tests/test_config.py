"""Config loads defaults and reads nested env overrides via the ``__`` delimiter,
and `setup_logging` applies the configured (or overridden) root level."""

from __future__ import annotations

import logging
from collections.abc import Iterator

import pytest

from events_curator.config import AppConfig, setup_logging
from events_curator.enums import LogLevel, NoisyLogger


def test_nested_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEDUP__AUTO_MERGE_THRESHOLD", "0.91")
    monkeypatch.setenv("STORAGE__DB_PATH", "/data/events.db")
    config = AppConfig()
    assert config.dedup.auto_merge_threshold == 0.91
    assert config.storage.db_path == "/data/events.db"


@pytest.fixture
def restore_root_logging() -> Iterator[None]:
    """`setup_logging` mutates the global root logger and the noisy third-party
    loggers; snapshot and restore them so these tests don't leak level/handler
    changes into the rest of the suite."""
    root = logging.getLogger()
    level, handlers = root.level, root.handlers[:]
    noisy_levels = {n: logging.getLogger(n.value).level for n in NoisyLogger}
    yield
    root.setLevel(level)
    root.handlers[:] = handlers
    for noisy, lvl in noisy_levels.items():
        logging.getLogger(noisy.value).setLevel(lvl)


def test_setup_logging_uses_configured_level(
    monkeypatch: pytest.MonkeyPatch, restore_root_logging: None
) -> None:
    monkeypatch.setenv("LOGGING__LEVEL", "WARNING")
    setup_logging(AppConfig())
    assert logging.getLogger().level == logging.WARNING


def test_setup_logging_override_beats_config(
    monkeypatch: pytest.MonkeyPatch, restore_root_logging: None
) -> None:
    monkeypatch.setenv("LOGGING__LEVEL", "WARNING")
    setup_logging(AppConfig(), level_override=LogLevel.DEBUG)
    assert logging.getLogger().level == logging.DEBUG


def test_setup_logging_pins_noisy_loggers(restore_root_logging: None) -> None:
    """Noisy third-party loggers stay at WARNING even when root is forced to
    DEBUG, so they don't follow the baseline down and flood the output."""
    setup_logging(AppConfig(), level_override=LogLevel.DEBUG)
    for noisy in NoisyLogger:
        assert logging.getLogger(noisy.value).level == logging.WARNING
