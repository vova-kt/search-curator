"""The default wiring assembles a runnable pipeline; with no API key configured it
flows through the real expand stage and FrontierWebSearch engine into the
UnconfiguredWebSearch backend, which raises with a pointer to the `llm` extra to
wire next. The config-driven factories pick each adapter (search backend/engine,
LLM, embedder), the store, and the authenticator that every UI shares — selecting
the real OpenAI adapter when a key + the `llm` extra are present, else the
`Unconfigured*` placeholder."""

from __future__ import annotations

import pytest

from events_curator.auth import LocalAuthenticator, TelegramAuthenticator
from events_curator.config import (
    AppConfig,
    AuthSettings,
    LLMSettings,
    SearchSettings,
    StorageSettings,
)
from events_curator.embed import UnconfiguredEmbedder
from events_curator.enums import AuthScheme, LLMProvider, SearchEngineKind
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
    pipeline = build_default_pipeline(AppConfig(), storage)
    query = SavedQuery(user_id=UserId("local"), text="jazz in berlin")
    await storage.queries.upsert(query)
    principal = Principal(user_id=UserId("local"), scheme=AuthScheme.LOCAL)

    with pytest.raises(NotImplementedError):
        await pipeline.run(query.id, principal)


def test_build_storage_in_memory_for_sentinel() -> None:
    config = AppConfig(storage=StorageSettings(db_path=":memory:"))
    assert isinstance(build_storage(config), InMemoryStorage)


def test_build_storage_sqlite_for_path() -> None:
    pytest.importorskip("sqlite_vec")  # the `store` extra
    from events_curator.storage import SqliteStorage  # noqa: PLC0415

    config = AppConfig(storage=StorageSettings(db_path="./events.db"))
    assert isinstance(build_storage(config), SqliteStorage)


def test_build_authenticator_local() -> None:
    config = AppConfig(auth=AuthSettings(scheme=AuthScheme.LOCAL))
    assert isinstance(build_authenticator(config), LocalAuthenticator)


def test_build_authenticator_telegram() -> None:
    config = AppConfig(auth=AuthSettings(scheme=AuthScheme.TELEGRAM))
    assert isinstance(build_authenticator(config), TelegramAuthenticator)


def test_build_authenticator_api_token_unwired() -> None:
    config = AppConfig(auth=AuthSettings(scheme=AuthScheme.API_TOKEN))
    with pytest.raises(NotImplementedError):
        build_authenticator(config)


def test_build_embedder_is_unconfigured() -> None:
    assert isinstance(build_embedder(AppConfig()), UnconfiguredEmbedder)


def test_build_llm_unconfigured_without_key() -> None:
    config = AppConfig(llm=LLMSettings(api_key=""))
    assert isinstance(build_llm(config), UnconfiguredLLM)


def test_build_llm_openai_with_key() -> None:
    pytest.importorskip("openai")  # the `llm` extra
    from events_curator.llm import OpenAIChat  # noqa: PLC0415

    config = AppConfig(llm=LLMSettings(api_key="sk-test", model="gpt-4o-mini"))
    assert isinstance(build_llm(config), OpenAIChat)


def test_build_llm_anthropic_unwired() -> None:
    config = AppConfig(llm=LLMSettings(provider=LLMProvider.ANTHROPIC))
    with pytest.raises(NotImplementedError):
        build_llm(config)


def test_build_search_backend_unconfigured_without_key() -> None:
    config = AppConfig(llm=LLMSettings(api_key=""))
    assert isinstance(build_search_backend(config), UnconfiguredWebSearch)


def test_build_search_backend_openai_with_key() -> None:
    pytest.importorskip("openai")  # the `llm` extra
    from events_curator.search import OpenAIWebSearch  # noqa: PLC0415

    config = AppConfig(llm=LLMSettings(api_key="sk-test", model="gpt-4o-mini"))
    assert isinstance(build_search_backend(config), OpenAIWebSearch)


def test_build_search_engine_frontier_default() -> None:
    assert isinstance(build_search_engine(AppConfig()), FrontierWebSearch)


def test_build_search_engine_rejects_unwired_kind() -> None:
    config = AppConfig(search=SearchSettings(engine=SearchEngineKind.EXA))
    with pytest.raises(NotImplementedError):
        build_search_engine(config)
