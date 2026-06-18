"""Search results as they flow through the pipeline.

`RawSearchResult`   — one candidate as extracted from a single source/search.
`CanonicalSearchResult` — the golden record: one real-world item, merged from
                   many raw sources via survivorship, carrying its embedding.
`Provenance` — which raw source won each golden field (audit trail).
`DedupOutcome` — what reconciliation decided for one candidate.
"""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import BaseModel, Field

from events_curator.enums import DedupDecision, SearchEngineKind
from events_curator.models.ids import (
    CanonicalSearchResultId,
    ExpandedQueryId,
    RawSearchResultId,
    Vector,
    new_canonical_search_result_id,
    new_raw_search_result_id,
)


def _now() -> datetime:
    return datetime.now(tz=UTC)


class Geo(BaseModel):
    city: str | None = None
    country: str | None = None
    venue: str | None = None
    lat: float | None = None
    lon: float | None = None


class RawSearchResult(BaseModel):
    id: RawSearchResultId = Field(default_factory=new_raw_search_result_id)
    source_query_id: ExpandedQueryId | None = None
    source_engine: SearchEngineKind
    url: str  # canonicalized at ingestion
    title: str
    description: str = ""
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    geo: Geo = Field(default_factory=Geo)
    image_url: str | None = None
    # open-ended per-domain facts (authors, organizer, salary, …) — the rule-4 escape hatch
    attributes: dict[str, str] = Field(default_factory=dict[str, str])
    price: str | None = None
    rank: int = 0  # position within its originating result list (for RRF)
    score: float | None = None  # engine-reported relevance, if any
    fetched_at: datetime = Field(default_factory=_now)


class CanonicalSearchResult(BaseModel):
    id: CanonicalSearchResultId = Field(default_factory=new_canonical_search_result_id)
    url: str
    title: str
    description: str = ""
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    geo: Geo = Field(default_factory=Geo)
    image_url: str | None = None
    # open-ended per-domain facts (authors, organizer, salary, …) — the rule-4 escape hatch
    attributes: dict[str, str] = Field(default_factory=dict[str, str])
    price: str | None = None
    source_search_result_ids: list[RawSearchResultId] = Field(
        default_factory=list[RawSearchResultId]
    )
    embedding: Vector | None = None
    first_seen_at: datetime = Field(default_factory=_now)
    last_seen_at: datetime = Field(default_factory=_now)


class Provenance(BaseModel):
    """Per-field survivorship winner for a canonical result."""

    canonical_search_result_id: CanonicalSearchResultId
    field_sources: dict[str, RawSearchResultId] = Field(
        default_factory=dict[str, RawSearchResultId]
    )


class DedupOutcome(BaseModel):
    candidate: RawSearchResult
    decision: DedupDecision
    canonical_search_result_id: CanonicalSearchResultId | None = None  # set when merged
    similarity: float | None = None
