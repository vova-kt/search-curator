"""Domain model defaults: id factories produce distinct ids, list/dict fields
default to fresh containers, and PreferenceProfile.label_count sums labels."""

from __future__ import annotations

from events_curator.enums import SearchEngineKind
from events_curator.models import (
    PreferenceProfile,
    RawSearchResult,
    SavedQuery,
    UserId,
    new_saved_query_id,
)


def test_id_factories_are_unique() -> None:
    assert new_saved_query_id() != new_saved_query_id()


def test_saved_query_defaults() -> None:
    query = SavedQuery(user_id=UserId("u1"), text="jazz in berlin")
    assert query.enabled is True
    assert query.tags == []
    assert query.window.start is None
    assert query.id  # default_factory populated it


def test_raw_search_result_independent_geo_per_instance() -> None:
    a = RawSearchResult(source_engine=SearchEngineKind.FRONTIER_NATIVE, url="u", title="t")
    b = RawSearchResult(source_engine=SearchEngineKind.FRONTIER_NATIVE, url="u", title="t")
    a.geo.city = "Berlin"
    assert b.geo.city is None  # default_factory, not a shared instance


def test_preference_profile_label_count() -> None:
    profile = PreferenceProfile(saved_query_id=new_saved_query_id(), like_count=3, dislike_count=2)
    assert profile.label_count == 5
