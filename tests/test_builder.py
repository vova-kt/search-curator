"""The default wiring assembles a runnable pipeline; running it flows through the
real expand stage and FrontierWebSearch engine into the UnconfiguredWebSearch
backend, which raises with a pointer to the `llm` extra to wire next."""

from __future__ import annotations

import pytest

from events_curator.config import AppConfig
from events_curator.enums import AuthScheme
from events_curator.models import Principal, SavedQuery, UserId
from events_curator.pipeline import build_default_pipeline
from events_curator.storage import InMemoryStorage


async def test_default_pipeline_reaches_search_stub() -> None:
    storage = InMemoryStorage()
    pipeline = build_default_pipeline(AppConfig(), storage)
    query = SavedQuery(user_id=UserId("local"), text="jazz in berlin")
    await storage.queries.upsert(query)
    principal = Principal(user_id=UserId("local"), scheme=AuthScheme.LOCAL)

    with pytest.raises(NotImplementedError):
        await pipeline.run(query.id, principal)
