"""Lexical similarity for dedup: MinHash over text shingles, kept dependency-free
and apart from the embedder/LLM adapters so the matching contract is unit-testable
without the network (mirrors ``search/_extract.py``).

MinHash estimates the Jaccard overlap of two records' word-shingle sets without
comparing the full sets — the fast lexical signal the design pairs with embedding
cosine. At a single NUC's corpus sizes exact Jaccard would do; MinHash keeps the
comparison a fixed-width signature so the same code holds up if the corpus grows.
"""

from __future__ import annotations

import hashlib
from datetime import datetime

_SHINGLE_WORDS = 2  # word k-gram width
_NUM_PERM = 64  # signature length; Jaccard-estimate error ~ 1/sqrt(NUM_PERM)
_MERSENNE = (1 << 61) - 1  # prime modulus for the (a*x + b) mod p hash family

Signature = tuple[int, ...]


def _hash64(value: str) -> int:
    return int.from_bytes(hashlib.blake2b(value.encode(), digest_size=8).digest(), "big")


def _coeff(tag: str, i: int) -> int:
    return _hash64(f"{tag}:{i}") % _MERSENNE


# Deterministic hash-family coefficients (derived, not RNG -> stable across runs).
_A = [_coeff("a", i) | 1 for i in range(_NUM_PERM)]  # odd and nonzero
_B = [_coeff("b", i) for i in range(_NUM_PERM)]


def shingles(text: str, k: int = _SHINGLE_WORDS) -> set[str]:
    tokens = text.casefold().split()
    if len(tokens) <= k:
        return {" ".join(tokens)} if tokens else set()
    return {" ".join(tokens[i : i + k]) for i in range(len(tokens) - k + 1)}


def minhash_signature(items: set[str]) -> Signature:
    if not items:
        return ()
    bases = [_hash64(item) for item in items]
    return tuple(min((a * h + b) % _MERSENNE for h in bases) for a, b in zip(_A, _B, strict=True))


def text_signature(text: str) -> Signature:
    return minhash_signature(shingles(text))


def jaccard(a: Signature, b: Signature) -> float:
    """Estimate the Jaccard overlap of two shingle sets from their signatures: the
    fraction of permutations whose minima agree. Empty/length-mismatched signatures
    score 0 — a record with no text overlaps nothing."""
    if not a or not b or len(a) != len(b):
        return 0.0
    return sum(1 for x, y in zip(a, b, strict=True) if x == y) / len(a)


def venue_time_match(
    a_venue: str | None,
    a_start: datetime | None,
    b_venue: str | None,
    b_start: datetime | None,
) -> bool:
    """Structured identity signal: two records at the *same venue* and *same start
    time* are very likely the same real-world event, even when their titles and
    descriptions diverge across ticket sources and languages — a recurring failure
    mode the text signals miss together (a Russian and an English listing of one
    show barely overlap lexically and only moderately by embedding, so both fall
    below the merge band). It is strong evidence, not proof: a source that defaults
    missing times to a fixed slot, or a multi-room venue, can put two *different*
    shows at the same venue+time. So a match here *routes the pair to the judge*
    rather than auto-merging. An empty venue or missing start can't anchor an
    identity, so it never matches another blank."""
    if not (a_venue and a_venue.strip()) or not (b_venue and b_venue.strip()):
        return False
    if a_start is None or b_start is None:
        return False
    return a_venue.strip().casefold() == b_venue.strip().casefold() and a_start == b_start


def combined_similarity(cosine: float, lexical: float) -> float:
    """Fuse the semantic (embedding cosine) and lexical (MinHash Jaccard) signals
    into the single score the thresholds split. We take the stronger of the two:
    strong wording overlap *or* strong semantic closeness is enough to flag a pair
    as a likely duplicate. This favours recall — the tiebreak-band LLM judge is the
    guard that stops a high-lexical-but-unrelated pair from auto-merging."""
    return max(cosine, lexical)
