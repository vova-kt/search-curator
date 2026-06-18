"""The per-domain attribute catalog and its lookup helpers. The catalog is a static
Python dict (not config); `instructions_for`/`emojis_for` project one domain's keys
for search and the UI, and an unknown/None domain yields an empty map rather than
raising, so a query whose domain isn't (yet) in the catalog still renders."""

from __future__ import annotations

import pytest

from events_curator.search import (
    DOMAIN_ATTRIBUTES,
    FALLBACK_DOMAIN,
    ExtractedResult,
    domain_descriptions,
    emojis_for,
    instructions_for,
)


def test_fallback_domain_is_a_catalog_key() -> None:
    assert FALLBACK_DOMAIN in DOMAIN_ATTRIBUTES


def test_domain_descriptions_cover_every_domain() -> None:
    assert set(domain_descriptions()) == set(DOMAIN_ATTRIBUTES)


def test_instructions_and_emojis_share_a_domains_keys() -> None:
    spec = DOMAIN_ATTRIBUTES["events"]
    assert set(instructions_for("events")) == set(spec.keys)
    assert set(emojis_for("events")) == set(spec.keys)
    assert instructions_for("events")["organizer"] == spec.keys["organizer"].instruction
    assert emojis_for("events")["organizer"] == spec.keys["organizer"].emoji


@pytest.mark.parametrize("domain", [None, "not_a_domain"])
def test_lookups_are_empty_for_unknown_domain(domain: str | None) -> None:
    assert instructions_for(domain) == {}
    assert emojis_for(domain) == {}


def test_attribute_keys_never_shadow_a_typed_field() -> None:
    # Free-form attributes exist only for facts without a dedicated column; a key that
    # collides with a typed ExtractedResult field would be ambiguous.
    typed = set(ExtractedResult.model_fields)
    for domain, spec in DOMAIN_ATTRIBUTES.items():
        assert typed.isdisjoint(spec.keys), domain
