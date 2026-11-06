---
phase: 03-search
plan: 01
subsystem: search
tags: [embeddings, sqlite, drizzle, transformers, ingest]
requires: []
provides:
  - agent_embeddings table (additive)
  - search/documents.ts, search/embedder.ts, search/embedder.fake.ts
  - ingest embedding step with staleness skip
affects: [03-03, 03-05]
tech-stack:
  added: ["@huggingface/transformers ^4.3.1"]
  patterns: [dynamic import with null-on-failure, content-hash staleness]
key-files:
  created:
    - src/lib/server/search/documents.ts
    - src/lib/server/search/embedder.ts
    - src/lib/server/search/embedder.fake.ts
    - src/lib/server/search/documents.test.ts
    - src/lib/server/search/embedder.test.ts
  modified:
    - drizzle/schema.ts
    - src/lib/server/db.ts
    - vitest.config.ts
    - scripts/ingest.ts
    - scripts/ingest.test.ts
    - Containerfile
    - README.md
    - package.json
    - package-lock.json
    - .planning/AUTONOMOUS-DECISIONS.md
key-decisions:
  - "D-009: @huggingface/transformers dependency, CUDA skip env var, BM25-only degradation"
metrics:
  tasks: 3
  completed: 2026-10-12
---

# Phase 3 Plan 01: Embedding storage and generation Summary

Additive `agent_embeddings` table plus a graceful-degrading local embedder (`@huggingface/transformers`, dynamic import, null on failure) and an ingest step that embeds only stale or missing agents.

## Tasks

1. Dependency, schema, documents/embedder/fake, tests: b4e3631
2. Ingest embedding step (staleness skip, orphan delete, null/off/no-table degradation): see git log (feat(03-01) ingest)
3. Containerfile (CUDA skip, HF_CACHE_DIR) and README notes: fee587f

## Verification

- Targeted vitest: search (8 tests) and scripts (25 tests) pass; `npx tsc --noEmit` clean.
- `npm run check` exits 0 (51 files, 460 tests).
- The fake embedder is imported only from tests; no test imports `@huggingface/transformers`; vitest sets `SEARCH_EMBEDDINGS=off`.

## Deviations from Plan

None - plan executed as written. D-009 was inserted just above D-008 in AUTONOMOUS-DECISIONS.md (ordering cosmetic).

## Notes

The real model path (`createTransformersEmbedder()` with the default loader) is untested here by design; plan 05 covers it.
