# Eval

An offline harness (`eval/`) to score the pipeline against golden fixtures. It
exists because every stage here is a judgment call (which sub-queries, which merges,
which order), and the only honest way to compare two implementations is to measure
them against known-good answers.

## The one idea

The harness is ignorant of *what* it's scoring. You hand it a `PredictFn` —
anything that takes a case and returns an ordered list of ids — plus a set of
metrics, and it runs them. Wire `predict` to a single stage to measure that stage in
isolation, or to the whole pipeline to measure end-to-end ranking; the same runner,
metrics, and report serve both. This is why a case carries golden *ordered ids* and
metrics score *ordered lists*: expand (sub-queries), dedup (canonical ids), and rank
(result ids) all reduce to the same shape.

## Pieces

- `eval/protocols.py` — `EvalCase`, the `PredictFn` signature, the `Metric` and
  `FixtureRepository` protocols.
- `eval/metrics.py` — precision@k, recall@k, MRR. Pure functions over id lists.
- `eval/runner.py` — applies a `PredictFn` to a stage's cases (concurrently, rule 5)
  and scores each prediction.
- `eval/report.py` — per-case scores plus a mean-per-metric `summary()`.

Runs are marked `RunMode.EVAL` — fixtures and comparisons, never live network or
persistence side effects.

## Adding cases

Implement a `FixtureRepository` that yields `EvalCase`s for a stage (typically loaded
from golden files on disk), pick metrics, and pass a `PredictFn` for the thing under
test to `EvalRunner.run`. The near-term focus is human-curated golden sets for expand
and rank, since those are where quality is won or lost.
