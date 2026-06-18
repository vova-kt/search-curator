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


class GeoBias(BaseModel):
    """A user's approximate location, used as a geographic bias for web search.
    Any field left blank is omitted; an all-blank bias means "no location
    preference" (e.g. a non-geographic target like papers)."""

    city: str = ""
    country: str = ""  # ISO 3166 alpha-2
    region: str = ""
    timezone: str = ""  # IANA name, e.g. "Europe/Berlin"


class User(BaseModel):
    id: UserId = Field(default_factory=new_user_id)
    display_name: str = ""
    location: GeoBias = Field(default_factory=GeoBias)  # where this user searches from
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
    # Attribute domain (a search/attributes.py catalog key), derived from `text` on
    # first run and cached here; None until classified.
    domain: str | None = None
    tags: list[str] = Field(default_factory=list[str])
    window: TimeWindow = Field(default_factory=TimeWindow)
    schedule_cron: str | None = None  # 5-field cron (UTC); None = manual / on-demand only
    schedule_text: str | None = None  # human-readable echo of the schedule, for display/edit
    max_results_shown: int = 10  # cap on results delivered to the user per run
    last_run_at: datetime | None = None  # last scheduled delivery; the cron base ("skip missed")
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
