# Preferences and ranking

How the curator learns what one recurring search likes, and how that reshapes the
next run. Ranking is `rank/`; learning is `feedback/`; the learned state is the
`PreferenceProfile` in `models/ranking.py`.

## Per-saved-query, not per-user

This is the load-bearing decision. Personalization keys on `SavedQueryId`, so the
same person's "jazz in Berlin" and "trail races in the Alps" each keep their own
taste. A global per-user profile would average those into mush. Concretely:
`Feedback` carries a `saved_query_id`, and the orchestrator reads/writes
preferences by query id around the rank stage.

## Two signals, learned from the same feedback

Each profile holds two things, updated together whenever feedback arrives:

- **Taste centroids** — the mean embedding of liked items and of disliked items.
  Cheap, always-on, and good for a fast prefilter (cosine to liked-minus-disliked).
  Concept: [concepts/taste-vectors.md](concepts/taste-vectors.md).
- **A natural-language summary** — a short LLM-written description of what this
  search wants ("prefers small venues, dislikes tribute acts"). It's what feeds
  the LLM reranker and what a human can read and correct.

Keeping both means the embedding signal works from the very first label while the
NL summary captures nuance the centroids can't.

## How ranking uses them

The intended flow (real impl, later): taste-vector prefilter to cut the candidate
set cheaply → LLM reranker fed the NL summary for the final order. Two refinements
kick in over time:

- a **logistic-regression blender** that combines the signals once feedback
  crosses `rank.logistic_blender_min_labels` (below that there's too little data
  to fit, so it's skipped);
- a couple of **exploration slots** (`rank.exploration_slots`) reserved for
  diverse/uncertain items, so the ranking doesn't collapse onto past likes and
  starve the feedback signal. Items filling a slot are flagged `is_exploration`.

All thresholds live in `config.py`.

Shipped today: `PreferenceRanker` and `ProfileUpdater` are stubs (raise). Both
need the `embed` + `llm` extras. The feedback path is otherwise wired: a like or
dislike with an optional free-text reason flows through the orchestrator (which
enforces ownership) into the learner.
