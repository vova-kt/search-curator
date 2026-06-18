"""Telegram frontend: a thin aiogram adapter over the transport-neutral
`apps/bot` assistant core. `main` is the `events-curator-bot` entrypoint."""

from __future__ import annotations

from events_curator.apps.telegram.app import main, run_bot

__all__ = ["main", "run_bot"]
