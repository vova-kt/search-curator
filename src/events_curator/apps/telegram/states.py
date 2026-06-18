"""FSM states for the multi-turn new-search dialogue. The running conversation and
the pending draft live in the aiogram in-memory FSM context, not here."""

from __future__ import annotations

from aiogram.fsm.state import State, StatesGroup


class BuildSearch(StatesGroup):
    collecting = State()  # gathering the new search across chat turns
