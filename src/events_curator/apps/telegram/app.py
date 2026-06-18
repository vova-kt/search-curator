"""The bot process: one asyncio program that both long-polls Telegram and runs the
schedule tick. The tick (`scheduler_tick_seconds`) asks the assistant for due runs
and delivers each batch to its owner's chat. All real work is in `apps/bot`."""

from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage

from events_curator.apps.bot import AssistantService, build_assistant
from events_curator.apps.telegram.deliver import send_deliveries
from events_curator.apps.telegram.handlers import build_router
from events_curator.apps.telegram.middleware import OwnerOnlyMiddleware
from events_curator.config import AppConfig, get_config, setup_logging
from events_curator.models import UserId
from events_curator.pipeline import build_storage

log = logging.getLogger(__name__)


class TelegramTokenMissingError(RuntimeError):
    """Raised when the bot is started without a `[telegram].token`."""


def _chat_id(user_id: UserId) -> int:
    """The Telegram chat id behind a `tg:<id>` namespaced user id."""
    return int(user_id.removeprefix("tg:"))


async def _scheduler_loop(service: AssistantService, bot: Bot, tick_seconds: int) -> None:
    log.info("bot scheduler up; tick=%ss", tick_seconds)
    while True:
        await asyncio.sleep(tick_seconds)
        try:
            batches = await service.run_due()
        except Exception:
            log.exception("scheduler tick failed")
            continue
        for batch in batches:
            if batch.deliveries:
                await send_deliveries(bot, _chat_id(batch.user_id), batch.deliveries)


async def run_bot(config: AppConfig | None = None) -> None:
    config = config or get_config()
    if not config.telegram.token:
        raise TelegramTokenMissingError("set [telegram].token (or TELEGRAM__TOKEN) to run the bot")
    storage = build_storage(config)
    await storage.init()
    service = build_assistant(config, storage)
    bot = Bot(config.telegram.token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dispatcher = Dispatcher(storage=MemoryStorage())
    router = build_router(service)
    guard = OwnerOnlyMiddleware(service, config.telegram.owner_id)
    router.message.outer_middleware(guard)
    router.callback_query.outer_middleware(guard)
    dispatcher.include_router(router)

    scheduler = asyncio.create_task(
        _scheduler_loop(service, bot, config.server.scheduler_tick_seconds)
    )
    try:
        await dispatcher.start_polling(bot)  # pyright: ignore[reportUnknownMemberType]
    finally:
        scheduler.cancel()
        await storage.close()


def main() -> None:
    setup_logging()
    asyncio.run(run_bot())


if __name__ == "__main__":
    main()
