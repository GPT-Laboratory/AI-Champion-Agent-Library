---
phase: 03-search
verified: 2026-10-12T17:00:00Z
status: human_needed
score: 3/4 truths fully verified automatically (1 and 4 partly pending real-model run)
human_verification:
  - test: "Real-model accuracy run: SEARCH_REAL_EMBEDDINGS=1 npx vitest run src/lib/server/search/accuracy.real.test.ts"
    expected: "hybrid hit@3 >= 0.8 incl. paraphrases on 150-agent and 9-agent corpora; hybrid paraphrase hit@3 >= BM25; tune SIM_FLOOR (untuned 0.25)"
    why_human: "Needs ~90 MB model download (network)"
  - test: "Populate embeddings (npm run db:push && npm run ingest) and query /catalog with a paraphrase"
    expected: "HVAC agent near top; /api/search reports mode hybrid; keyword 'rfi' exact matches first"
    why_human: "Needs real embeddings"
  - test: "Live typing feel in browser on /catalog"
    expected: "200 ms debounce, focus/caret kept, no scroll jump, URL ?q=, no-results text, SR announcement"
    why_human: "No browser; visual and real-time behaviour"
---

# Phase 3: Search Verification Report

**Phase Goal:** Users can find agents using natural language queries or short keywords, with results appearing live as they type
**Status:** human_needed (no code gaps found)
**Re-verification:** No

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | NL query ranks semantically relevant agents on top | ? PARTLY (code verified, real-model quality pending) | `hybrid.ts` cosine + weighted RRF over stored vectors; `index.ts` embeds query with timeout race; ingest `scripts/ingest.ts` writes `agent_embeddings` with staleness skip. Fake-embedder accuracy tests pass. Real model accuracy not run. |
| 2 | Short keyword returns exact matches even with low similarity | VERIFIED | `bm25.ts` with prefix matching, always fused at weight 1.0; semantic weight halved for <=2 tokens; BM25-only fallback when no embedder/vectors (mode `bm25`). keyword hit@3 >= 0.8 test passes. |
| 3 | Results update live, no submit button | VERIFIED in code (feel pending) | `SearchBar.svelte` 200 ms debounce -> `updateQuery` -> `goto(?q=..., keepFocus, noScroll, replaceState)` -> `catalog/+page.server.ts` calls `search(q)`, applies filters, ranks and paginates. No submit button; clear button and aria-live count present. |
| 4 | Labeled test set of 20+ pairs passes before done | VERIFIED for fake embedder / PENDING real | `accuracy.test.ts` asserts >=20 scale queries, keyword/nl/paraphrase minimums, 150-doc corpus, 9 real agents; hit@3 >= 0.8 for keyword+nl passes. Real-model run (`accuracy.real.test.ts`, skipped without env) pending. |

## Required Artifacts / Wiring

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/server/search/{bm25,hybrid,tokenize,documents,embedder,index}.ts` | VERIFIED | Substantive, wired via `index.ts` singleton |
| `src/routes/api/search/+server.ts` | VERIFIED | Calls `search()`, returns slug/score/mode, 500 on error |
| `src/routes/catalog/+page.server.ts` / `+page.svelte` | VERIFIED | `q` handled; SearchBar wired to URL |
| `src/lib/components/SearchBar.svelte` | VERIFIED | Used in catalog page |
| `scripts/ingest.ts` embedding step | VERIFIED | Never throws, honors `SEARCH_EMBEDDINGS=off` |
| `src/hooks.server.ts` | VERIFIED | Calls `warmUp()` |

## Tests run

- `vitest run src/lib/server/search src/routes src/lib/components/SearchBar.test.ts`: 16 files passed, 1 skipped (real-model), 119 tests passed.
- `npm run check`: 56 files passed, 1 skipped, 498 tests passed.

## Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| SRCH-01 | SATISFIED in code, quality pending real-model run | embeddings + cosine |
| SRCH-02 | SATISFIED | BM25 + weighted RRF, BM25 fallback |
| SRCH-03 | SATISFIED in code, feel pending human | debounced SearchBar + URL-driven loader |

REQUIREMENTS.md traceability table and ROADMAP checkboxes still show Phase 3 as Pending/not started (stale docs, not code gaps). No orphaned requirements.

## Anti-Patterns

| File | Pattern | Severity |
|------|---------|----------|
| `hybrid.ts` | `SIM_FLOOR = 0.25` untuned | Info (tracked in UAT) |
| `.planning/ROADMAP.md`, `REQUIREMENTS.md` | Phase 3 status stale | Info |

## Gaps Summary

No code gaps. Remaining work is the three human items in 03-HUMAN-UAT.md (real-model accuracy and SIM_FLOOR tuning, real embeddings check, browser feel), plus updating ROADMAP/REQUIREMENTS status once they pass.

_Verified: 2026-10-12_
_Verifier: Claude (gsd-verifier)_
