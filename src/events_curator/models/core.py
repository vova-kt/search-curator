"""User, the authenticated caller, and saved queries.

A single user owns many *saved queries* — recurrent searches for different
topics / cities / time windows. Preferences are scoped to the saved query, not
the user, so the same person's "jazz in Berlin" and "trail races in the Alps"
learn independently.
"""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import BaseModel, Field

from events_curator.enums import AuthScheme
from events_curator.models.ids import (
    ExpandedQueryId,
    SavedQueryId,
    UserId,
    new_expanded_query_id,
    new_saved_query_id,
    new_user_id,
)


def _now() -> datetime:
    return datetime.now(tz=UTC)


class User(BaseModel):
    id: UserId = Field(default_factory=new_user_id)
    display_name: str = ""
    created_at: datetime = Field(default_factory=_now)


class Principal(BaseModel):
    """The authenticated identity behind a request. Produced by `auth`."""

    user_id: UserId
    scheme: AuthScheme
    display_name: str = ""


class TimeWindow(BaseModel):
    """When the user wants results. Either bound may be open."""

    start: datetime | None = None
    end: datetime | None = None


class SavedQuery(BaseModel):
    id: SavedQueryId = Field(default_factory=new_saved_query_id)
    user_id: UserId
    text: str
    city: str | None = None
    country: str | None = None
    tags: list[str] = Field(default_factory=list[str])
    window: TimeWindow = Field(default_factory=TimeWindow)
    schedule_cron: str | None = None  # None = manual / on-demand only
    enabled: bool = True
    created_at: datetime = Field(default_factory=_now)


class ExpandedQuery(BaseModel):
    """One concrete web query derived from a SavedQuery by the Expander."""

    id: ExpandedQueryId = Field(default_factory=new_expanded_query_id)
    saved_query_id: SavedQueryId
    text: str


class ExpandedQuerySet(BaseModel):
    saved_query_id: SavedQueryId
    queries: list[ExpandedQuery]
