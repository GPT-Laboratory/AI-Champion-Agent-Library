---
phase: 11-related-agents-disc-01
plan: 01
subsystem: search
tags: [related-agents, cosine, jaccard, DISC-01]
requires: [phase-03 search service, phase-2.2 scale corpus]
provides: [relatedAgents, fallbackScore, SearchService.related, related()]
affects: [11-02]
key-files:
  created:
    - src/lib/server/search/related.ts
    - src/lib/server/search/related.test.ts
    - src/lib/server/search/related.validation.test.ts
  modified:
    - src/lib/server/search/index.ts
    - src/lib/server/search/index.test.ts
decisions: [D-027]
requirements: [DISC-01]
completed: 2026-10-12
---

# Phase 11 Plan 01: Related agents algorithm Summary

Pure `relatedAgents` (embedding cosine with tag/category/tool Jaccard fallback, mixed-vector merge) exposed as `SearchService.related()`/`related()` reusing the content-hash-checked vector cache.

## Accomplishments
- `related.ts`: deterministic, excludes self, at most k, no I/O.
- Scale-corpus validation: precision@4 measured 1.0 on fallback, fake-embedding and mixed (every 5th vector dropped) paths; enforced at 0.9 / 0.95 / 0.8.
- Service method falls back when embedder is null, vectors are stale or missing, or the embedder times out; never throws.

## Deviations from Plan
None. Note: the agents table has no llm column, so the optional `llmName` row field is plumbed but unused today.

## Commits
Task 1 feat(11-01) pure relatedAgents; Task 2 test(11-01) validation; Task 3 feat(11-01) service method (see git log).

## Self-Check: PASSED
