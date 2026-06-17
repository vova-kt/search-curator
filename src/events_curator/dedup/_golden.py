"""Golden-record survivorship for dedup: fold a fresh candidate into one canonical
result and track the provenance of which raw source won each field.

Survivorship here is first-non-empty-wins (plus a tag union): the canonical keeps
a field once any source has filled it, and provenance records the raw result that
did. Without per-source trust scores this is the order we can defend — the
earliest complete sighting holds the field, later sightings only fill gaps. Fields
inherited unchanged from a prior-session canonical carry no provenance entry this
run (their origin lives in the run that first set them; the store's read side does
not return old provenance).
"""

from __future__ import annotations

from events_curator.models import (
    CanonicalSearchResult,
    Geo,
    Provenance,
    RawSearchResult,
    Vector,
)

# Top-level canonical fields settled by first-non-empty survivorship. `geo` and
# `tags` are folded specially (subfield fill / set union) below.
_SCALAR_FIELDS = ("title", "description", "starts_at", "ends_at", "price")


def doc_text(record: RawSearchResult | CanonicalSearchResult) -> str:
    """The text dedup hashes/embeds for a record: title and description together."""
    return f"{record.title}\n{record.description}".strip()


def _is_empty(value: object) -> bool:
    if value is None:
        return True
    return isinstance(value, str) and not value.strip()


def _has_geo(geo: Geo) -> bool:
    return any(not _is_empty(v) for v in geo.model_dump().values())


def _union_tags(existing: list[str], extra: list[str]) -> list[str]:
    merged = dict.fromkeys(existing)
    for tag in extra:
        merged.setdefault(tag)
    return list(merged)


def _merge_geo(base: Geo, extra: Geo) -> tuple[Geo, bool]:
    data = base.model_dump()
    filled = False
    for key, value in extra.model_dump().items():
        if _is_empty(data.get(key)) and not _is_empty(value):
            data[key] = value
            filled = True
    return Geo.model_validate(data), filled


def new_golden(
    candidate: RawSearchResult, embedding: Vector
) -> tuple[CanonicalSearchResult, Provenance]:
    """Promote a candidate that matched nothing into its own canonical record,
    attributing every field it populated to itself."""
    canonical = CanonicalSearchResult(
        url=candidate.url,
        title=candidate.title,
        description=candidate.description,
        starts_at=candidate.starts_at,
        ends_at=candidate.ends_at,
        geo=candidate.geo.model_copy(deep=True),
        tags=list(candidate.tags),
        price=candidate.price,
        source_search_result_ids=[candidate.id],
        embedding=embedding,
        first_seen_at=candidate.fetched_at,
        last_seen_at=candidate.fetched_at,
    )
    sources = {f: candidate.id for f in _SCALAR_FIELDS if not _is_empty(getattr(candidate, f))}
    if candidate.tags:
        sources["tags"] = candidate.id
    if _has_geo(candidate.geo):
        sources["geo"] = candidate.id
    return canonical, Provenance(canonical_search_result_id=canonical.id, field_sources=sources)


def merge_into(
    target: CanonicalSearchResult, provenance: Provenance, candidate: RawSearchResult
) -> tuple[CanonicalSearchResult, Provenance]:
    """Fold `candidate` into `target`: fill empty golden fields, union tags, append
    the source id, and advance the seen-at window. Returns the updated record and
    provenance (the original inputs are left untouched)."""
    updates: dict[str, object] = {}
    sources = dict(provenance.field_sources)
    for field in _SCALAR_FIELDS:
        if _is_empty(getattr(target, field)) and not _is_empty(getattr(candidate, field)):
            updates[field] = getattr(candidate, field)
            sources[field] = candidate.id
    geo, geo_filled = _merge_geo(target.geo, candidate.geo)
    if geo_filled:
        updates["geo"] = geo
        sources.setdefault("geo", candidate.id)
    tags = _union_tags(target.tags, list(candidate.tags))
    if tags != target.tags:
        updates["tags"] = tags
        sources.setdefault("tags", candidate.id)
    if candidate.id not in target.source_search_result_ids:
        updates["source_search_result_ids"] = [*target.source_search_result_ids, candidate.id]
    updates["last_seen_at"] = max(target.last_seen_at, candidate.fetched_at)
    updates["first_seen_at"] = min(target.first_seen_at, candidate.fetched_at)
    merged = target.model_copy(update=updates)
    return merged, Provenance(canonical_search_result_id=target.id, field_sources=sources)


__all__ = ["doc_text", "merge_into", "new_golden"]
