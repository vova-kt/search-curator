# Concept: Reciprocal Rank Fusion (RRF)

## What it is

A way to combine several ranked lists into one. Each item's fused score is the
sum, over the lists it appears in, of `1 / (k + rank)`, where `rank` is its
position in that list and `k` is a small constant (we use 60, the common
default). Items that appear near the top of many lists win; an item buried deep
in one list contributes almost nothing.

## Why it matters here

The expand stage fans one user query into several sub-queries, and each is
searched separately, producing several ranked lists of results. We need one list.
The naïve alternative — comparing the engines' raw relevance scores — fails
because those scores aren't calibrated against each other (one engine's "0.9"
isn't another's). RRF ignores the scores and uses only *positions*, so it needs
no calibration, has one barely-sensitive parameter, and degrades gracefully when
one sub-query returns junk.

## Practical takeaway

`k` damps the advantage of the very top ranks; larger `k` flattens the
contribution curve. The default rarely needs tuning. Because RRF is positional,
the merge stage must preserve each item's rank within its source list — which is
why raw results carry a `rank`. Implementation: `merge/`.
