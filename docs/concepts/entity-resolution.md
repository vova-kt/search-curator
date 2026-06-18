# Concept: Entity resolution (dedup)

## What it is

Deciding when two records describe the *same real-world thing* and collapsing
them into one. The same concert shows up as different URLs, titles, and blurbs
across sites and across reruns of the query. Entity resolution has three classic
parts:

- **Blocking** — don't compare every record to every other ($O(n^2)$). First
  bucket records by a cheap key so only plausible matches are compared. Here the
  key is date(±N days) + city: two items on different dates in different cities
  can't be the same, so they never get scored.
- **Similarity** — within a block, measure how alike two records are. We fuse two
  text signals by taking the stronger: **MinHash** (a fast estimate of text overlap
  — how many shingles two titles or descriptions share) and **embedding cosine**
  (semantic closeness). Two thresholds split that score into auto-merge / tiebreak /
  new. A third, structured signal — **venue+start-time** (the same place at the same
  instant) — does *not* fold into the score; it routes a pair to the tiebreak judge,
  rescuing the case the text signals miss together (one show listed on two sites in
  two languages overlaps little lexically and only moderately by embedding) without
  auto-merging on evidence that a multi-room venue could fake.
- **Survivorship** — once records are judged to match, build one **golden
  record** by picking, per field, the value from the most trustworthy source, and
  record where each value came from (provenance).

## Why it matters here

Without it the corpus fills with duplicates, ranking shows the user the same
item five times, and feedback gets split across copies so the preference signal
never accumulates. Cross-session dedup is what makes the stored corpus a clean,
growing memory rather than a pile.

## Practical takeaway

Blocking is the scalability lever; the date+city key is chosen so it almost never
wrongly separates a true match. The **tiebreak band** between the two thresholds
(plus any venue+start-time match) is where the signals are ambiguous — there we
defer to an LLM judge rather than guessing. The judge is **batched**: a run holds
back all its ambiguous pairs and decides them in one call, so reconciliation costs
one LLM round-trip per run, not one per pair. Thresholds live in `config.py` so
eval can sweep them. Implementation: `dedup/`; the cross-session lookup is
`SearchResultStore.nearest`.
