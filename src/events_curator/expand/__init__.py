"""Expand stage: turn a SavedQuery into the concrete web queries to run.

The interesting variant is multi-query fan-out (one LLM call → N sub-queries),
which is what makes ChatGPT/Claude search feel good. For now we ship the
identity stub — a singleton list of the user's own query.
"""

from __future__ import annotations

import logging
from typing import Protocol

from events_curator.enums import Stage
from events_curator.models import ExpandedQuery, ExpandedQuerySet, SavedQuery

_LOG = logging.getLogger(f"events_curator.stage.{Stage.EXPAND.value}")


class Expander(Protocol):
    async def expand(self, query: SavedQuery) -> ExpandedQuerySet: ...


class IdentityExpander(Expander):
    """STUB: user query -> singleton list of user query. Replace with LLM fan-out."""

    async def expand(self, query: SavedQuery) -> ExpandedQuerySet:
        _LOG.debug(f"identity: expanding query id={query.id}")
        return ExpandedQuerySet(
            saved_query_id=query.id,
            queries=[ExpandedQuery(saved_query_id=query.id, text=query.text)],
        )


__all__ = ["Expander", "IdentityExpander"]
