"""Inline-keyboard builders. Each returns an `InlineKeyboardMarkup` whose buttons
carry the typed callbacks from `callbacks.py`."""

from __future__ import annotations

from aiogram.types import InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from events_curator.apps.telegram.callbacks import DraftCB, FeedbackCB, MenuCB, SearchCB
from events_curator.enums import BotAction, FeedbackKind
from events_curator.models import CanonicalSearchResultId, SavedQueryId


def menu_keyboard() -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="🔎 New search", callback_data=MenuCB(action=BotAction.NEW_SEARCH))
    kb.button(text="📂 Saved searches", callback_data=MenuCB(action=BotAction.LIST_SEARCHES))
    kb.adjust(1)
    return kb.as_markup()


def draft_keyboard() -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="✅ Confirm", callback_data=DraftCB(action=BotAction.CONFIRM))
    kb.button(text="✏️ Edit", callback_data=DraftCB(action=BotAction.EDIT))
    kb.button(text="🗑 Discard", callback_data=DraftCB(action=BotAction.DISCARD))
    kb.adjust(3)
    return kb.as_markup()


def search_keyboard(query_id: SavedQueryId) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="▶️ Run now", callback_data=SearchCB(action=BotAction.RUN_NOW, query_id=query_id))
    kb.button(text="🗑 Delete", callback_data=SearchCB(action=BotAction.DELETE, query_id=query_id))
    kb.adjust(2)
    return kb.as_markup()


def feedback_keyboard(
    query_id: SavedQueryId, result_id: CanonicalSearchResultId
) -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(
        text="👍",
        callback_data=FeedbackCB(kind=FeedbackKind.LIKE, query_id=query_id, result_id=result_id),
    )
    kb.button(
        text="👎",
        callback_data=FeedbackCB(kind=FeedbackKind.DISLIKE, query_id=query_id, result_id=result_id),
    )
    kb.adjust(2)
    return kb.as_markup()
