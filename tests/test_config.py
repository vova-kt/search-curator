"""Config loads from ``config.toml`` with **no in-code defaults**: every field must
be present in the file (env vars override via the ``__`` delimiter), and a missing
field fails validation. `LLMSettings` carries per-call-site model/temperature/prompt
and requires every `LLMRole` to be configured. `setup_logging` applies the
configured (or overridden) root level."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest
from pydantic import ValidationError

from events_curator.config import (
    AppConfig,
    LLMRoleSettings,
    LLMSettings,
    get_config,
    setup_logging,
)
from events_curator.enums import LLMProvider, LLMRole, LogLevel, NoisyLogger


def _roles() -> dict[LLMRole, LLMRoleSettings]:
    return {
        role: LLMRoleSettings(model="m", temperature=0.0, prompt=role.value) for role in LLMRole
    }


def _llm_settings(roles: dict[LLMRole, LLMRoleSettings] | None = None) -> LLMSettings:
    return LLMSettings(
        provider=LLMProvider.OPENAI, api_key="", model="base-model", roles=roles or _roles()
    )


def test_nested_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEDUP__AUTO_MERGE_THRESHOLD", "0.91")
    monkeypatch.setenv("STORAGE__DB_PATH", "/data/events.db")
    config = get_config()
    assert config.dedup.auto_merge_threshold == 0.91
    assert config.storage.db_path == "/data/events.db"


def test_env_overrides_toml(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM__MODEL", "from-env")
    assert get_config().llm.model == "from-env"  # baseline toml says "test-model"


def test_toml_loads_nested_groups_and_enum_keyed_roles() -> None:
    config = get_config()  # the committed config.test.toml baseline
    assert config.dedup.auto_merge_threshold == 0.88
    judge = config.llm.for_role(LLMRole.DEDUP_JUDGE)
    assert (judge.model, judge.prompt) == ("test-model", "test dedup judge prompt")


def test_toml_loads_telegram_and_the_search_builder_role() -> None:
    config = get_config()  # the committed config.test.toml baseline
    assert config.telegram.owner_id == "42"
    builder = config.llm.for_role(LLMRole.SEARCH_BUILDER)
    assert builder.prompt == "test search builder prompt"


def test_for_role_returns_that_call_sites_settings() -> None:
    roles = _roles()
    roles[LLMRole.RANK_RERANKER] = LLMRoleSettings(model="r", temperature=0.7, prompt="rp")
    settings = _llm_settings(roles=roles)
    resolved = settings.for_role(LLMRole.RANK_RERANKER)
    assert (resolved.model, resolved.temperature, resolved.prompt) == ("r", 0.7, "rp")


def test_missing_role_is_rejected() -> None:
    with pytest.raises(ValidationError):
        LLMSettings(
            provider=LLMProvider.OPENAI,
            api_key="",
            model="m",
            roles={LLMRole.DEDUP_JUDGE: LLMRoleSettings(model="m", temperature=0.0, prompt="p")},
        )


def test_missing_required_field_is_rejected() -> None:
    with pytest.raises(ValidationError):
        LLMRoleSettings(model="m", temperature=0.0)  # type: ignore[call-arg]  # prompt omitted


def test_temperature_out_of_range_is_rejected() -> None:
    with pytest.raises(ValidationError):
        LLMRoleSettings(model="m", temperature=3.0, prompt="p")


def test_incomplete_toml_is_rejected(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    toml = tmp_path / "config.toml"  # defines only [storage], every other group is missing
    toml.write_text('[storage]\ndb_path = ":memory:"\n', encoding="utf-8")
    monkeypatch.setitem(cast("dict[str, object]", AppConfig.model_config), "toml_file", str(toml))
    with pytest.raises(ValidationError):
        get_config()


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
    setup_logging(get_config())
    assert logging.getLogger().level == logging.WARNING


def test_setup_logging_override_beats_config(
    monkeypatch: pytest.MonkeyPatch, restore_root_logging: None
) -> None:
    monkeypatch.setenv("LOGGING__LEVEL", "WARNING")
    setup_logging(get_config(), level_override=LogLevel.DEBUG)
    assert logging.getLogger().level == logging.DEBUG


def test_setup_logging_pins_noisy_loggers(restore_root_logging: None) -> None:
    """Noisy third-party loggers stay at WARNING even when root is forced to
    DEBUG, so they don't follow the baseline down and flood the output."""
    setup_logging(get_config(), level_override=LogLevel.DEBUG)
    for noisy in NoisyLogger:
        assert logging.getLogger(noisy.value).level == logging.WARNING
