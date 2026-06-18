"""Transport-neutral value objects the assistant core hands to a chat frontend."""

from __future__ import annotations

from dataclasses import dataclass, field

from events_curator.models import CanonicalSearchResult, SavedQueryId, UserId


@dataclass(frozen=True)
class Delivery:
    """One result to deliver to a user. Carries the canonical result to render, the
    saved query it belongs to (so a feedback button can reference it), and that
    query's attribute `domain` (so the renderer can pick each attribute's emoji)."""

    saved_query_id: SavedQueryId
    domain: str | None
    result: CanonicalSearchResult


@dataclass(frozen=True)
class DeliveryBatch:
    """A user's results from one scheduled run, addressed by `user_id` so the
    frontend knows where to send them. Empty `deliveries` means the run found
    nothing new — the frontend stays silent."""

    user_id: UserId
    deliveries: list[Delivery] = field(default_factory=list[Delivery])
