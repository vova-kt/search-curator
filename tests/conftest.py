"""Test-wide config baseline.

`AppConfig` has no in-code defaults: every field must come from `config.toml` (or
an env override), so a bare `AppConfig()` needs a complete file. Tests point it at
the committed `config.test.toml` instead of the developer's local `config.toml` —
a complete, keyless, in-memory baseline that a test can override one field at a
time (via env vars or the constructor) without dragging in a live API key.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest

from events_curator.config import AppConfig, get_config

TEST_CONFIG_TOML = str(Path(__file__).parent.parent / "config.test.toml")


@pytest.fixture(autouse=True)
def isolate_config_from_toml(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Pin `AppConfig` to `config.test.toml`; reset the cached singleton too."""
    monkeypatch.setitem(
        cast("dict[str, object]", AppConfig.model_config), "toml_file", TEST_CONFIG_TOML
    )
    get_config.cache_clear()
    yield
    get_config.cache_clear()
