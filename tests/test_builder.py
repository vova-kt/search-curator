"""The default wiring assembles a runnable pipeline; with no API key configured it
flows through the real expand stage and FrontierWebSearch engine into the
UnconfiguredWebSearch backend, which raises with a pointer to the `llm` extra to
wire next. The config-driven factories pick each adapter (search backend/engine,
LLM, embedder), the store, and the authenticator that every UI shares — selecting
the real OpenAI adapter when a key + the `llm` extra are present, else the
`Unconfigured*` placeholder.

Config has no in-code defaults, so each test starts from the complete
`config.test.toml` baseline (pinned by conftest) and overrides one field at a time
through the env source — the same precedence Docker/CI uses in production."""

from __future__ import annotations

import pytest

from events_curator.auth import LocalAuthenticator, TelegramAuthenticator
from events_curator.config import get_config
from events_curator.embed import UnconfiguredEmbedder
from events_curator.enums import AuthScheme
from events_curator.llm import UnconfiguredLLM
from events_curator.models import Principal, SavedQuery, UserId
from events_curator.pipeline import (
    build_authenticator,
    build_default_pipeline,
    build_embedder,
    build_llm,
    build_search_backend,
    build_search_engine,
    build_storage,
)
from events_curator.search import FrontierWebSearch, UnconfiguredWebSearch
from events_curator.storage import InMemoryStorage


async def test_default_pipeline_reaches_search_stub() -> None:
    storage = InMemoryStorage()
    pipeline = build_default_pipeline(get_config(), storage)
    query = SavedQuery(user_id=UserId("local"), text="jazz in berlin")
    await storage.queries.upsert(query)
    principal = Principal(user_id=UserId("local"), scheme=AuthScheme.LOCAL)

    with pytest.raises(NotImplementedError):
        await pipeline.run(query.id, principal)


def test_build_storage_in_memory_for_sentinel(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STORAGE__DB_PATH", ":memory:")
    assert isinstance(build_storage(get_config()), InMemoryStorage)


def test_build_storage_sqlite_for_path(monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("sqlite_vec")  # the `store` extra
    from events_curator.storage import SqliteStorage  # noqa: PLC0415

    monkeypatch.setenv("STORAGE__DB_PATH", "./events.db")
    assert isinstance(build_storage(get_config()), SqliteStorage)


def test_build_authenticator_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH__SCHEME", AuthScheme.LOCAL.value)
    assert isinstance(build_authenticator(get_config()), LocalAuthenticator)


def test_build_authenticator_telegram(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH__SCHEME", AuthScheme.TELEGRAM.value)
    assert isinstance(build_authenticator(get_config()), TelegramAuthenticator)


def test_build_authenticator_api_token_unwired(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTH__SCHEME", AuthScheme.API_TOKEN.value)
    with pytest.raises(NotImplementedError):
        build_authenticator(get_config())


def test_build_embedder_bge_default() -> None:
    pytest.importorskip("sentence_transformers")  # the `embed` extra
    from events_curator.embed import BgeEmbedder  # noqa: PLC0415

    assert isinstance(build_embedder(get_config()), BgeEmbedder)


def test_build_embedder_openai_with_key(monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("openai")  # the `llm` extra
    from events_curator.embed import OpenAIEmbedder  # noqa: PLC0415

    monkeypatch.setenv("LLM__API_KEY", "sk-test")
    monkeypatch.setenv("EMBEDDING__KIND", "openai")
    monkeypatch.setenv("EMBEDDING__MODEL", "text-embedding-3-small")
    assert isinstance(build_embedder(get_config()), OpenAIEmbedder)


def test_build_embedder_openai_unconfigured_without_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMBEDDING__KIND", "openai")  # baseline key is empty
    assert isinstance(build_embedder(get_config()), UnconfiguredEmbedder)


def test_build_llm_unconfigured_without_key() -> None:
    assert isinstance(build_llm(get_config()), UnconfiguredLLM)  # baseline key is empty


def test_build_llm_openai_with_key(monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("openai")  # the `llm` extra
    from events_curator.llm import OpenAIChat  # noqa: PLC0415

    monkeypatch.setenv("LLM__API_KEY", "sk-test")
    assert isinstance(build_llm(get_config()), OpenAIChat)


def test_build_llm_anthropic_unwired(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM__PROVIDER", "anthropic")
    with pytest.raises(NotImplementedError):
        build_llm(get_config())


def test_build_search_backend_unconfigured_without_key() -> None:
    assert isinstance(
        build_search_backend(get_config()), UnconfiguredWebSearch
    )  # baseline empty key


def test_build_search_backend_openai_with_key(monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("openai")  # the `llm` extra
    from events_curator.search import OpenAIWebSearch  # noqa: PLC0415

    monkeypatch.setenv("LLM__API_KEY", "sk-test")
    assert isinstance(build_search_backend(get_config()), OpenAIWebSearch)


def test_build_search_engine_frontier_default() -> None:
    assert isinstance(build_search_engine(get_config()), FrontierWebSearch)


def test_build_search_engine_rejects_unwired_kind(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SEARCH__ENGINE", "exa")
    with pytest.raises(NotImplementedError):
        build_search_engine(get_config())
