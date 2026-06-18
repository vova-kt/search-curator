"""The per-domain attribute vocabulary: a static, typed catalog (not config).

`attributes` on a result is a free-form `dict[str, str]` escape hatch for facts
with no dedicated typed field (title, url, dates, geo, image, price all have one).
Its *allowed keys* are a closed set, grouped by domain here. A saved query's domain
is derived once (`search/_classify.py`) and cached on `SavedQuery.domain`; search
then offers only that domain's keys to the model and the UI renders them with each
key's emoji.

Adding or retargeting a domain is a deliberate edit to this catalog — by design a
code change, not deployment config (CLAUDE.md rule 4). Keys are lowercase
snake_case and must not duplicate a typed `ExtractedResult`/`RawSearchResult` field.
"""

from __future__ import annotations

from pydantic import BaseModel


class AttributeSpec(BaseModel):
    """One allowed attribute key: a fill instruction handed to the search model and
    an emoji shown beside the value in the UI."""

    instruction: str
    emoji: str


class DomainSpec(BaseModel):
    """One curated domain: a one-line description that steers the classifier, plus
    its allowed attribute keys."""

    description: str
    keys: dict[str, AttributeSpec]


# The catalog. Each domain's keys avoid facts that already have a typed field.
DOMAIN_ATTRIBUTES: dict[str, DomainSpec] = {
    "events": DomainSpec(
        description="Concerts, festivals, conferences, talks, meetups, drops, competitions"
        ", and scheduled happenings.",
        keys={
            "organizer": AttributeSpec(instruction="Who runs or hosts the event", emoji="🏛️"),
            "tags": AttributeSpec(
                instruction="short event tags (eg music genres, conference topics etc), max 2",
                emoji="🎵",
            ),
            "program": AttributeSpec(
                instruction="Headline acts or speakers, comma-separated if applicable", emoji="🎤"
            ),
            "ticket_availability": AttributeSpec(
                instruction="on sale, sold out, free, or waitlist if applicable",
                emoji="🎟️",
            ),
        },
    ),
    "papers": DomainSpec(
        description="Academic papers, preprints, and research publications.",
        keys={
            "authors": AttributeSpec(instruction="Paper authors, comma-separated", emoji="✍️"),
            "published_in": AttributeSpec(
                instruction="Journal, conference, or preprint server (e.g. NeurIPS, arXiv)",
                emoji="📚",
            ),
            "doi": AttributeSpec(instruction="Digital Object Identifier", emoji="🔖"),
            "institution": AttributeSpec(instruction="Affiliated institutions or labs", emoji="🏫"),
            "code_url": AttributeSpec(
                instruction="Link to released code or dataset, if any", emoji="💻"
            ),
            "topics": AttributeSpec(
                instruction="Research topics or keywords, comma-separated", emoji="🏷️"
            ),
        },
    ),
    "jobs": DomainSpec(
        description="Job and role postings at companies or organizations.",
        keys={
            "company": AttributeSpec(instruction="Hiring company or organization", emoji="🏢"),
            "salary": AttributeSpec(instruction="Compensation or salary range", emoji="💰"),
            "employment_type": AttributeSpec(
                instruction="Full-time, part-time, contract, or internship", emoji="📋"
            ),
            "remote_policy": AttributeSpec(instruction="Remote, hybrid, or on-site", emoji="🏠"),
            "seniority": AttributeSpec(
                instruction="Experience level: junior, mid, senior, lead, etc.", emoji="📈"
            ),
        },
    ),
    "real_estate": DomainSpec(
        description="Property listings for sale or rent.",
        keys={
            "property_type": AttributeSpec(
                instruction="House, apartment, condo, land, etc.", emoji="🏠"
            ),
            "listing_type": AttributeSpec(instruction="For sale or for rent", emoji="🏷️"),
            "bedrooms": AttributeSpec(instruction="Number of bedrooms", emoji="🛏️"),
            "bathrooms": AttributeSpec(instruction="Number of bathrooms", emoji="🛁"),
            "area": AttributeSpec(instruction="Floor area with units (sq ft or m²)", emoji="📐"),
            "agent": AttributeSpec(instruction="Listing agent or agency", emoji="🧑‍💼"),
        },
    ),
    "products": DomainSpec(
        description="Physical products, gadgets, and shopping deals.",
        keys={
            "brand": AttributeSpec(instruction="Manufacturer or brand", emoji="🏷️"),
            "retailer": AttributeSpec(instruction="Store or marketplace selling it", emoji="🛒"),
            "original_price": AttributeSpec(
                instruction="List price before any discount", emoji="💵"
            ),
            "discount": AttributeSpec(instruction="Discount amount or percent off", emoji="🔻"),
            "rating": AttributeSpec(instruction="Average customer rating, e.g. 4.5/5", emoji="⭐"),
            "availability": AttributeSpec(
                instruction="In stock, pre-order, or out of stock", emoji="📦"
            ),
        },
    ),
    "vehicles": DomainSpec(
        description="Used or new cars and other vehicles for sale.",
        keys={
            "make_model": AttributeSpec(instruction="Manufacturer and model", emoji="🚗"),
            "model_year": AttributeSpec(instruction="Model year", emoji="📅"),
            "mileage": AttributeSpec(instruction="Odometer reading with units", emoji="🛣️"),
            "fuel_type": AttributeSpec(
                instruction="Petrol, diesel, hybrid, or electric", emoji="⛽"
            ),
            "transmission": AttributeSpec(instruction="Manual or automatic", emoji="⚙️"),
            "seller_type": AttributeSpec(instruction="Dealer or private seller", emoji="🧑‍💼"),
        },
    ),
    "grants": DomainSpec(
        description="Grants, funding calls, fellowships, and calls for proposals.",
        keys={
            "funder": AttributeSpec(
                instruction="Funding body or sponsoring organization", emoji="🏛️"
            ),
            "award_amount": AttributeSpec(instruction="Grant size or award amount", emoji="💰"),
            "deadline": AttributeSpec(instruction="Submission or application deadline", emoji="⏳"),
            "eligibility": AttributeSpec(instruction="Who is eligible to apply", emoji="✅"),
            "field": AttributeSpec(instruction="Research field or topic area", emoji="🔬"),
        },
    ),
    "software_releases": DomainSpec(
        description="Software releases, library versions, and open-source projects.",
        keys={
            "project": AttributeSpec(instruction="Project or repository name", emoji="📦"),
            "version": AttributeSpec(instruction="Release version or tag", emoji="🏷️"),
            "language": AttributeSpec(instruction="Primary programming language", emoji="💻"),
            "license": AttributeSpec(
                instruction="Software license, e.g. MIT, Apache-2.0", emoji="📜"
            ),
            "changelog_url": AttributeSpec(
                instruction="Link to release notes or changelog", emoji="📝"
            ),
        },
    ),
    "travel": DomainSpec(
        description="Flight, hotel, and travel deals.",
        keys={
            "origin": AttributeSpec(instruction="Departure city or airport", emoji="🛫"),
            "destination": AttributeSpec(instruction="Arrival city or airport", emoji="🛬"),
            "carrier": AttributeSpec(
                instruction="Operating airline, hotel chain, or provider", emoji="✈️"
            ),
            "trip_type": AttributeSpec(instruction="One-way or round-trip", emoji="🔁"),
            "cabin_class": AttributeSpec(
                instruction="Economy, premium, business, or first", emoji="💺"
            ),
        },
    ),
}

# Used when classification can't be resolved to a known domain. Must be a catalog key.
FALLBACK_DOMAIN = "events"


def instructions_for(domain: str | None) -> dict[str, str]:
    """The `key -> fill instruction` map for one domain (empty for an unknown/None
    domain), as `submit_tool` expects it."""
    spec = DOMAIN_ATTRIBUTES.get(domain) if domain is not None else None
    return {} if spec is None else {key: a.instruction for key, a in spec.keys.items()}


def emojis_for(domain: str | None) -> dict[str, str]:
    """The `key -> emoji` map for one domain (empty for an unknown/None domain), as
    the UI uses to prefix each rendered attribute."""
    spec = DOMAIN_ATTRIBUTES.get(domain) if domain is not None else None
    return {} if spec is None else {key: a.emoji for key, a in spec.keys.items()}


def domain_descriptions() -> dict[str, str]:
    """The `domain -> description` map the classifier offers the model to choose from."""
    return {name: spec.description for name, spec in DOMAIN_ATTRIBUTES.items()}
