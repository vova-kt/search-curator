"""Typed inline-button payloads. aiogram packs each into the 64-byte `callback_data`
budget; the ids are the short 22-char base64 form (see `models/ids.py`) so two of
them plus an action still fit. Actions are the shared `BotAction`/`FeedbackKind`
enums — never raw strings (rule 4)."""

from __future__ import annotations

from aiogram.filters.callback_data import CallbackData

from events_curator.enums import BotAction, FeedbackKind


class MenuCB(CallbackData, prefix="m"):
    """Main-menu buttons: NEW_SEARCH or LIST_SEARCHES."""

    action: BotAction


class DraftCB(CallbackData, prefix="d"):
    """Draft-confirmation buttons: CONFIRM, EDIT, or DISCARD."""

    action: BotAction


class SearchCB(CallbackData, prefix="s"):
    """Saved-search row buttons: RUN_NOW or DELETE, for one query."""

    action: BotAction
    query_id: str


class FeedbackCB(CallbackData, prefix="f"):
    """The 👍/👎 on a delivered result, scoped to the query it came from."""

    kind: FeedbackKind
    query_id: str
    result_id: str
