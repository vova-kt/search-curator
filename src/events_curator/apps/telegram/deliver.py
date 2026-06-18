"""Sending result messages over aiogram. One silent HTML message per result, each
with its 👍/👎 keyboard and no link preview. Shared by the manual `Run now` path
and the scheduler loop."""

from __future__ import annotations

from collections.abc import Sequence

from aiogram import Bot
from aiogram.types import LinkPreviewOptions

from events_curator.apps.bot.types import Delivery
from events_curator.apps.telegram.keyboards import feedback_keyboard
from events_curator.apps.telegram.render import render_result

_NO_PREVIEW = LinkPreviewOptions(is_disabled=True)


async def send_deliveries(bot: Bot, chat_id: int, deliveries: Sequence[Delivery]) -> None:
    for delivery in deliveries:
        await bot.send_message(
            chat_id,
            render_result(delivery),
            reply_markup=feedback_keyboard(delivery.saved_query_id, delivery.result.id),
            disable_notification=True,
            link_preview_options=_NO_PREVIEW,
        )
