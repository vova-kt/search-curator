"""Telegram bot adapter — a thin UI over the pipeline.

Flow (when wired with the `bot` extra / aiogram): a message authenticates the
chat into a Principal, `/search <text>` upserts a SavedQuery and runs the
pipeline, and inline like/dislike buttons call `record_feedback`. Kept import-
light (no aiogram import) so the skeleton type-checks before the dep is added.
"""

from __future__ import annotations

from events_curator.auth import Authenticator
from events_curator.models import Feedback, RankedSearchResult, SavedQuery
from events_curator.pipeline import CurationPipeline


class TelegramBot:
    def __init__(self, pipeline: CurationPipeline, authenticator: Authenticator) -> None:
        self._pipeline = pipeline
        self._auth = authenticator

    async def on_search(self, credential: str, query: SavedQuery) -> list[RankedSearchResult]:
        principal = await self._auth.authenticate(credential)
        if principal is None:
            raise PermissionError("unauthenticated chat")
        return await self._pipeline.run(query.id, principal)

    async def on_feedback(self, credential: str, feedback: Feedback) -> None:
        principal = await self._auth.authenticate(credential)
        if principal is None:
            raise PermissionError("unauthenticated chat")
        await self._pipeline.record_feedback(feedback, principal)

    async def start(self) -> None:
        raise NotImplementedError("Install the `bot` extra and wire aiogram polling/webhook here.")
