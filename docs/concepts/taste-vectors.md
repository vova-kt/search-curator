# Concept: Taste vectors (preference centroids)

## What it is

A way to represent "what this search likes" as geometry. Embed each result into a
vector (a fixed-length list of numbers where semantically similar results land
near each other). Average the vectors of the liked results into one **liked
centroid**, and the disliked ones into a **disliked centroid**. To score a new
result, embed it and measure cosine similarity to those centroids — closer to
liked and farther from disliked is better. The `liked − disliked` direction is a
cheap "preference axis."

## Why it matters here

Ranking needs a signal that works from the very first label and costs almost
nothing to evaluate over a whole candidate set. Centroids do exactly that: one
embedding per result (cacheable) and a couple of dot products. They're the
always-on prefilter that trims the set before the expensive LLM reranker runs.
They're scoped per saved query, so each recurring search builds its own axis —
see [../preferences.md](../preferences.md).

## Practical takeaway

Centroids are coarse: they capture "more like these, less like those" but not
nuance ("ok except tribute acts"). That nuance is why we *also* keep a
natural-language summary for the LLM reranker. Centroids degrade if likes are
multimodal (two unrelated clusters average to a meaningless midpoint) — a known
limitation we accept at this scale, and a reason the LLM reranker has the final
say. Embeddings default to local `bge-small` (CPU-friendly on the NUC).
