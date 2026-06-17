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

`PreferenceRanker` (`rank/`) runs the flow: a **taste-vector prefilter** orders
every result on the liked-minus-disliked axis and keeps the top `rank.top_n` —
cheap because it reuses each canonical's stored embedding and only embeds (one
batched call) the rare result that lacks one. An **LLM reranker**, fed the NL
summary, then orders that kept set. The reranker's reply is parsed conservatively:
any candidate the model drops or names twice is repaired (omitted ones are appended
in prefilter order), so a misbehaving reply can never lose or duplicate a result —
the same defensive posture as dedup's judge.

A couple of **exploration slots** (`rank.exploration_slots`) are then carved out of
the returned list for the most *uncertain* leftover candidates — those whose taste
score sits nearest zero, i.e. the ones the centroids are least sure about. They're
flagged `is_exploration` so a UI can mark them, and they exist so the ranking
doesn't collapse onto past likes and starve the feedback signal of fresh labels.

Not yet built: the **logistic-regression blender** that the design folds in past
`rank.logistic_blender_min_labels`. Fitting it needs the individual labelled
vectors, but the rank stage only receives the centroid *profile*, not the feedback
history — so threading those through (or storing fitted weights on the profile) is
the prerequisite, and it's deferred until the taste+LLM signal proves insufficient.

All thresholds live in `config.py`.

## Learning from feedback

`ProfileUpdater` (`feedback/`) folds one like/dislike into the profile. It looks the
liked/disliked item up in the result store (so it needs the read side, not just the
two preference stores), takes that item's vector — its stored embedding, or a fresh
embedding if it has none — and advances the matching centroid by an **exact
incremental mean**, so a new label costs one update, never a re-scan of history. In
the same step an LLM rewrites the NL summary from the prior summary plus the new
label and its free-text reason. The embed and the summary call are independent, so
they're dispatched concurrently (rule 5). The whole path is wired through the
orchestrator, which enforces ownership before the learner ever runs.

Shipped today: both stages are real. They drive the shared `Embedder` and
`LLMClient` ports, which default to the Unconfigured placeholders — so a live run
raises with a pointer to the `embed`/`llm` extra until real adapters are wired.
`OpenAIChat` (`llm/`, extra `llm`) is the concrete `LLMClient`, re-exported lazily
from the module door like `search.OpenAIWebSearch`.
