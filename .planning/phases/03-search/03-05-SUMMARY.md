---
phase: 03-search
plan: 05
subsystem: search
tags: [accuracy, bm25, fixtures, uat]
requires: [03-01, 03-02]
provides:
  - labeledQueries (34 scale + 12 real), loadScaleCorpus, loadRealCorpus
  - BM25 accuracy gate (hit@3 >= 0.8) in CI
  - skip-by-default real-model accuracy test
affects: [03-04]
key-files:
  created:
    - src/lib/server/search/fixtures/corpus.ts
    - src/lib/server/search/fixtures/queries.ts
    - src/lib/server/search/accuracy.test.ts
    - src/lib/server/search/accuracy.real.test.ts
    - .planning/phases/03-search/03-HUMAN-UAT.md
key-decisions:
  - "D-011: BM25 thresholds enforced in CI; paraphrase accuracy only in the skipped real-model test (pending human)"
metrics:
  tasks: 2
  completed: 2026-10-12
---

# Phase 3 Plan 05: Accuracy tests Summary

Labeled set of 46 queries (scale: 14 keyword, 10 nl, 10 paraphrase over all 10 topics; real: 6 keyword, 3 nl, 3 paraphrase) over the 150-agent synthetic corpus and the 9 real agents.

## Tasks

1. Corpus loaders and query fixtures: 4847126
2. Accuracy tests, real-model test, UAT note, D-010/D-011: ae696cf

## Results (BM25, measured)

| Set | hit@1 | hit@3 | MRR |
| --- | --- | --- | --- |
| scale keyword+nl | 1.00 | 1.00 | 1.00 |
| real keyword+nl | 1.00 | 1.00 | 1.00 |
| scale paraphrase (info only) | 0.30 | 0.40 | 0.35 |
| real paraphrase (info only) | 0.33 | 0.67 | 0.44 |

Keyword exactness holds (top 3 of every keyword query contain the token). Hybrid plumbing with the fake embedder: mode `hybrid`, unique valid slugs, deterministic, BM25 top hit stays in hybrid top 3, `queryVector: null` equals BM25. No ranking tuning was needed.

## Verification

- `npx vitest run src/lib/server/search`: 7 files pass, `accuracy.real.test.ts` skipped. `createTransformersEmbedder()` is called only in the real test; `SEARCH_REAL_EMBEDDINGS` stayed unset, no model was fetched.
- Full `npm run check` exits 0 (54 files passed, 1 skipped, 489 tests passed, 1 skipped).

## Pending human

Real-model run and real-embedding ingest: `.planning/phases/03-search/03-HUMAN-UAT.md` (also retune `SIM_FLOOR`).

## Deviations from Plan

- The fixture-sanity test includes an extra check that paraphrase queries share no tokens with topic keywords/tool names; it caught and led to rewording of two labels ("question", "time").
- Real-corpus slugs `mep-submittal-review-router` and `energy-model-data-sync` come from normalize(), not the filenames.
