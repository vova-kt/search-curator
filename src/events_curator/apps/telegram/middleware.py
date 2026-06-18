"""Access control as an aiogram middleware. Today only the configured owner may use
the bot: an authorized update gets a `Principal` injected for the handlers; any
other chat is silently ignored and the owner is notified once per new chat id.

This is the seam where a public join-request/approve flow slots in later — the
notification already carries the requester's id."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message, TelegramObject
from aiogram.types import User as TgUser

from events_curator.apps.bot import AssistantService


class OwnerOnlyMiddleware(BaseMiddleware):
    def __init__(self, service: AssistantService, owner_chat_id: str) -> None:
        self._service = service
        self._owner_chat_id = owner_chat_id
        self._notified: set[int] = set()

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        if not isinstance(event, Message | CallbackQuery):
            return await handler(event, data)
        user = event.from_user
        if user is None:
            return None
        principal = await self._service.authorize(str(user.id))
        if principal is None:
            await self._notify_owner(event, user)
            return None
        data["principal"] = principal
        return await handler(event, data)

    async def _notify_owner(self, event: Message | CallbackQuery, user: TgUser) -> None:
        if user.id in self._notified or event.bot is None:
            return
        self._notified.add(user.id)
        name = user.full_name or (f"@{user.username}" if user.username else "unknown")
        await event.bot.send_message(
            self._owner_chat_id,
            f"🔔 Access request from {name} (id <code>{user.id}</code>). "
            "Approve-from-Telegram is coming later.",
        )
