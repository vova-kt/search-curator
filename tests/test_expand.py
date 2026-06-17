"""IdentityExpander: a SavedQuery expands to a singleton list carrying the
user's own text and the saved query id."""

from __future__ import annotations

from events_curator.expand import IdentityExpander
from events_curator.models import SavedQuery, UserId


async def test_identity_expander_returns_singleton() -> None:
    query = SavedQuery(user_id=UserId("u1"), text="indie film amsterdam")
    expanded = await IdentityExpander().expand(query)

    assert expanded.saved_query_id == query.id
    assert len(expanded.queries) == 1
    only = expanded.queries[0]
    assert only.text == "indie film amsterdam"
    assert only.saved_query_id == query.id
