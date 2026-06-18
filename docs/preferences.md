# Preferences and ranking

How the curator learns what one recurring search likes, and how that reshapes the
next run. Ranking is `rank/`; learning is `feedback/`; the learned state is the
`PreferenceProfile` in `models/ranking.py`. Both stages drive the shared `Embedder`
and `LLMClient` ports (see
[architecture.md](architecture.md#adapters-and-extras)).

## Per-saved-query, not per-user

The load-bearing decision. Personalization keys on `SavedQueryId`, so the same
person's "jazz in Berlin" and "trail races in the Alps" each keep their own taste; a
global per-user profile would average those into mush. `Feedback` carries a
`saved_query_id`, and the orchestrator reads/writes preferences by query id around
the rank stage.

## Two signals, learned from the same feedback

Each profile holds two things, updated together whenever feedback arrives:

- **Taste centroids** — the mean embedding of liked items and of disliked items.
  Cheap, always-on, good for a fast prefilter (cosine to liked-minus-disliked).
  Concept: [concepts/taste-vectors.md](concepts/taste-vectors.md).
- **A natural-language summary** — a short LLM-written description of what this
  search wants ("prefers small venues, dislikes tribute acts"). It feeds the LLM
  reranker, and a human can read and correct it.

The embedding signal works from the very first label; the NL summary captures nuance
the centroids can't.

## How ranking uses them

`PreferenceRanker` runs a **taste-vector prefilter** that orders every result on the
liked-minus-disliked axis and keeps the top `rank.top_n` — cheap because it reuses
each canonical's stored embedding and only embeds (one batched call) the rare result
lacking one. An **LLM reranker** (the `rank_reranker` role), fed the NL summary, then
orders that kept set, answering through a `submit_ranking` function tool (the
submit-tool pattern, `rank/_rerank.py`). The submission is read conservatively: any
candidate the model drops or names twice is repaired (omitted ones appended in
prefilter order), so a misbehaving reply can never lose or duplicate a result.

A couple of **exploration slots** (`rank.exploration_slots`) are then carved out for
the most *uncertain* leftover candidates — those whose taste score sits nearest zero.
Flagged `is_exploration` so a UI can mark them, they keep the ranking from collapsing
onto past likes and starving the feedback signal of fresh labels.

Not yet built: the **logistic-regression blender** folded in past
`rank.logistic_blender_min_labels`. Fitting it needs the individual labelled vectors,
but the rank stage receives only the centroid *profile*, not the feedback history —
so threading those through (or storing fitted weights on the profile) is the
prerequisite, deferred until the taste+LLM signal proves insufficient.

Thresholds live in `config.py`; the reranker and the summary rewriter are the
`rank_reranker` and `feedback_summary` LLM roles
([configuration.md](configuration.md)).

## Learning from feedback

`ProfileUpdater` folds one like/dislike into the profile. It looks the item up in the
result store, takes its vector (stored embedding, or a fresh one if it has none), and
advances the matching centroid by an **exact incremental mean** — a new label costs
one update, never a re-scan of history. In the same step an LLM (the
`feedback_summary` role) rewrites the NL summary from the prior summary plus the new
label and its free-text reason. The embed and summary calls are independent, so they
run concurrently (rule 5). The whole path runs through the orchestrator, which
enforces ownership before the learner runs.
