"""aiogram handlers: the chat surface. Each handler is a thin shell — parse the
update, call one `AssistantService` method, render the reply. All domain logic
(auth, ranking, persistence, scheduling) lives in `apps/bot`, never here.

The principal is injected by `OwnerOnlyMiddleware`, so every handler runs only for
the authorized owner."""

# Handlers are registered by decorator side-effect, not called by name.
# pyright: reportUnusedFunction=false

from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, Message

from events_curator.apps.bot import AssistantService, InvalidScheduleError
from events_curator.apps.telegram.callbacks import DraftCB, FeedbackCB, MenuCB, SearchCB
from events_curator.apps.telegram.deliver import send_deliveries
from events_curator.apps.telegram.keyboards import (
    draft_keyboard,
    menu_keyboard,
    search_keyboard,
)
from events_curator.apps.telegram.render import render_draft, render_saved_query
from events_curator.apps.telegram.states import BuildSearch
from events_curator.auth import NotOwnerError
from events_curator.enums import BotAction, FeedbackKind
from events_curator.llm import ChatMessage
from events_curator.models import CanonicalSearchResultId, Principal, SavedQueryId
from events_curator.pipeline import UnknownSavedQueryError
from events_curator.search_builder import SearchDraft

_GREETING = "Hi! What would you like me to keep an eye on?"
_ASK = "Tell me what to search for — the topic, an optional city, and how often I should check."


def _answerable(query: CallbackQuery) -> Message | None:
    return query.message if isinstance(query.message, Message) else None


async def _reply(
    query: CallbackQuery, text: str, reply_markup: InlineKeyboardMarkup | None = None
) -> None:
    msg = _answerable(query)
    if msg is not None:
        await msg.answer(text, reply_markup=reply_markup)
    elif query.bot is not None:
        await query.bot.send_message(query.from_user.id, text, reply_markup=reply_markup)


async def _start_dialogue(message: Message, state: FSMContext) -> None:
    await state.set_state(BuildSearch.collecting)
    await state.update_data(conversation=[], draft=None)
    await message.answer(_ASK)


async def _show_searches(message: Message, service: AssistantService, principal: Principal) -> None:
    queries = await service.list_searches(principal)
    if not queries:
        await message.answer("No saved searches yet.", reply_markup=menu_keyboard())
        return
    for query in queries:
        await message.answer(render_saved_query(query), reply_markup=search_keyboard(query.id))


def _register_menu(router: Router, service: AssistantService) -> None:
    @router.message(CommandStart())
    @router.message(Command("menu"))
    async def on_start(message: Message, state: FSMContext) -> None:
        await state.clear()
        await message.answer(_GREETING, reply_markup=menu_keyboard())

    @router.message(Command("new_search"))
    async def cmd_new_search(message: Message, state: FSMContext) -> None:
        await _start_dialogue(message, state)

    @router.message(Command("saved_searches"))
    async def cmd_saved(message: Message, principal: Principal) -> None:
        await _show_searches(message, service, principal)

    @router.callback_query(MenuCB.filter(F.action == BotAction.NEW_SEARCH))
    async def cb_new_search(query: CallbackQuery, state: FSMContext) -> None:
        msg = _answerable(query)
        if msg is not None:
            await _start_dialogue(msg, state)
        await query.answer()

    @router.callback_query(MenuCB.filter(F.action == BotAction.LIST_SEARCHES))
    async def cb_list(query: CallbackQuery, principal: Principal) -> None:
        msg = _answerable(query)
        if msg is not None:
            await _show_searches(msg, service, principal)
        await query.answer()


def _register_dialogue(router: Router, service: AssistantService) -> None:
    @router.message(BuildSearch.collecting, F.text)
    async def on_dialogue(message: Message, state: FSMContext) -> None:
        data = await state.get_data()
        conversation: list[ChatMessage] = list(data.get("conversation", []))
        conversation.append(ChatMessage(role="user", content=message.text or ""))
        if message.bot is not None:
            await message.bot.send_chat_action(message.chat.id, "typing")
        turn = await service.build_turn(conversation)
        conversation.append(ChatMessage(role="assistant", content=turn.message))
        await state.update_data(conversation=conversation, draft=turn.draft)
        if turn.draft is not None:
            await message.answer(render_draft(turn.draft), reply_markup=draft_keyboard())
        else:
            await message.answer(turn.message)

    @router.callback_query(DraftCB.filter(F.action == BotAction.CONFIRM))
    async def cb_confirm(query: CallbackQuery, principal: Principal, state: FSMContext) -> None:
        draft: SearchDraft | None = (await state.get_data()).get("draft")
        if draft is None:
            await query.answer("Nothing to confirm.")
            return
        try:
            saved = await service.save_search(principal, draft)
        except InvalidScheduleError:
            await query.answer("That schedule wasn't valid — let's adjust it.", show_alert=True)
            return
        await state.clear()
        await _reply(query, "Saved ✅", reply_markup=search_keyboard(saved.id))
        await query.answer()

    @router.callback_query(DraftCB.filter(F.action == BotAction.EDIT))
    async def cb_edit(query: CallbackQuery) -> None:
        await _reply(query, "Sure — what should I change?")
        await query.answer()

    @router.callback_query(DraftCB.filter(F.action == BotAction.DISCARD))
    async def cb_discard(query: CallbackQuery, state: FSMContext) -> None:
        await state.clear()
        await _reply(query, "Discarded.", reply_markup=menu_keyboard())
        await query.answer()


def _register_searches(router: Router, service: AssistantService) -> None:
    @router.callback_query(SearchCB.filter(F.action == BotAction.RUN_NOW))
    async def cb_run_now(
        query: CallbackQuery, callback_data: SearchCB, principal: Principal
    ) -> None:
        await query.answer("Running…")
        try:
            deliveries = await service.run_now(principal, SavedQueryId(callback_data.query_id))
        except (UnknownSavedQueryError, NotOwnerError) as exc:
            await _reply(query, f"Couldn't run: {exc}")
            return
        if not deliveries:
            await _reply(query, "No new results right now.")
        elif query.bot is not None:
            await send_deliveries(query.bot, query.from_user.id, deliveries)

    @router.callback_query(SearchCB.filter(F.action == BotAction.DELETE))
    async def cb_delete(
        query: CallbackQuery, callback_data: SearchCB, principal: Principal
    ) -> None:
        try:
            await service.delete_search(principal, SavedQueryId(callback_data.query_id))
        except (UnknownSavedQueryError, NotOwnerError) as exc:
            await query.answer(str(exc), show_alert=True)
            return
        await query.answer("Deleted.")
        msg = _answerable(query)
        if msg is not None:
            await msg.edit_text("🗑 Deleted.")


def _register_feedback(router: Router, service: AssistantService) -> None:
    @router.callback_query(FeedbackCB.filter())
    async def cb_feedback(
        query: CallbackQuery, callback_data: FeedbackCB, principal: Principal
    ) -> None:
        try:
            await service.record_feedback(
                principal,
                SavedQueryId(callback_data.query_id),
                CanonicalSearchResultId(callback_data.result_id),
                callback_data.kind,
            )
        except NotImplementedError:
            await query.answer("Saved (profile update needs the llm/embed extras).")
            return
        except (UnknownSavedQueryError, NotOwnerError) as exc:
            await query.answer(str(exc), show_alert=True)
            return
        liked = callback_data.kind is FeedbackKind.LIKE
        await query.answer("👍 Thanks!" if liked else "👎 Noted.")

    @router.message(F.text)
    async def on_other(message: Message) -> None:
        await message.answer("Use the menu to get started.", reply_markup=menu_keyboard())


def build_router(service: AssistantService) -> Router:
    """Wire every handler onto one router. Split into focused registrars so each
    stays small; ordering matters — the stateful dialogue handler is registered
    before the catch-all text handler so it wins while a draft is being built."""
    router = Router(name="events-curator-bot")
    _register_menu(router, service)
    _register_dialogue(router, service)
    _register_searches(router, service)
    _register_feedback(router, service)
    return router
