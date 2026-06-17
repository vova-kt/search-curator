"""Test-wide config isolation.

`AppConfig` declares `env_file=".env"`, so a bare `AppConfig()` inside a test would
load whatever the developer keeps in their local `.env`. A live `LLM__API_KEY`
there makes the keyless-path tests build the real OpenAI adapters instead of the
`Unconfigured*` placeholders they assert on. Disabling the dotenv source for the
duration of every test makes config depend only on what the test sets explicitly.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import cast

import pytest

from events_curator.config import AppConfig, get_config


@pytest.fixture(autouse=True)
def isolate_config_from_dotenv(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Stop `AppConfig` reading the real `.env`; reset the cached singleton too."""
    monkeypatch.setitem(cast("dict[str, object]", AppConfig.model_config), "env_file", None)
    get_config.cache_clear()
    yield
    get_config.cache_clear()
