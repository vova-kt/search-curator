"""Transport-neutral chat-assistant core. `AssistantService` is the one object a
chat frontend drives (see `apps/telegram` for the aiogram adapter); everything
here speaks domain types, not chat-API frames, so a second frontend can reuse it.

`build_assistant` is the production wiring (pipeline + storage + Telegram-namespaced
auth + the search-builder LLM role). Tests construct `AssistantService` directly
with fakes.
"""

from __future__ import annotations

from events_curator.apps.bot.schedule import is_due, is_valid_cron, next_fire, now_utc
from events_curator.apps.bot.service import AssistantService, InvalidScheduleError
from events_curator.apps.bot.types import Delivery, DeliveryBatch
from events_curator.auth import TelegramAuthenticator
from events_curator.config import AppConfig, get_config
from events_curator.enums import LLMRole
from events_curator.pipeline import build_default_pipeline, build_llm, build_storage
from events_curator.search_builder import SearchBuilder
from events_curator.storage import Storage


def build_assistant(
    config: AppConfig | None = None, storage: Storage | None = None
) -> AssistantService:
    config = config or get_config()
    store = storage or build_storage(config)
    pipeline = build_default_pipeline(config, store)
    role = config.llm.for_role(LLMRole.SEARCH_BUILDER)
    builder = SearchBuilder(
        build_llm(config),
        system_prompt=role.prompt,
        model=role.model,
        temperature=role.temperature,
    )
    return AssistantService(
        pipeline=pipeline,
        storage=store,
        authenticator=TelegramAuthenticator(),
        builder=builder,
        owner_id=config.telegram.owner_id,
    )


__all__ = [
    "AssistantService",
    "Delivery",
    "DeliveryBatch",
    "InvalidScheduleError",
    "build_assistant",
    "is_due",
    "is_valid_cron",
    "next_fire",
    "now_utc",
]
