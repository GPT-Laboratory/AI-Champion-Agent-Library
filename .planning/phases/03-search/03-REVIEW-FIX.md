---
phase: 03-search
fixed_at: 2026-10-12T17:15:00Z
review_path: /home/ville/projects/aic-agent-library/.planning/phases/03-search/03-REVIEW.md
iteration: 1
findings_in_scope: 10
fixed: 10
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report

**Fixed at:** 2026-10-12
**Source review:** /home/ville/projects/aic-agent-library/.planning/phases/03-search/03-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 10 (CR-01, WR-01..WR-09), plus the security-audit extras and two trivial Info items
- Fixed: 10 (plus IN-01, IN-02 and parts of IN-04 and IN-05)
- Skipped: 0 (optional sub-items listed under "Not done")

**Verification ran in:** a git worktree (`.claude/worktrees/agent-a83c5a4bf906dceda`, branch `worktree-agent-a83c5a4bf906dceda`) with its own `npm ci`. `SEARCH_EMBEDDINGS=off` throughout; no model was downloaded and `SEARCH_REAL_EMBEDDINGS` was never set. Final gate: `npm run check` exited 0 (58 test files passed, 1 skipped; 554 tests passed, 1 skipped). Baseline before the fixes was 498 tests passed.

Items marked "requires human verification" are logic or UI-behaviour changes. Their new tests pass, but tsc and the unit tests cannot prove the semantics in a real browser or with the real model.

## Fixed Issues

### CR-01: Search truncates to top 50 before filters and pagination

**Files modified:** `src/lib/server/search/index.ts`, `src/routes/catalog/+page.server.ts`, `src/routes/catalog/catalog.test.ts`, `src/routes/catalog/catalog.scale.test.ts`, `src/lib/server/search/index.test.ts`
**Commit:** 8ec21c9
**Status:** fixed: requires human verification (logic)
**Applied fix:** `search(q, { limit })` is passed through to `hybridSearch`. The catalog load calls `search(q, { limit: Infinity })`, then filters and paginates, so `total` and `totalPages` count every match. The slug IN-list is chunked at 500 to stay under SQLite's bound-variable limit (IN-04). `/api/search` keeps its top-50 default, and the non-`q` path is unchanged. A scale test (150 agents, query `review`, more than 50 matches) checks that each category-filtered total equals the unfiltered ranking intersected with the filter. I confirmed that test and a mock test fail without the fix.

### WR-01: Vector cache goes stale after ingest

**Files modified:** `src/lib/server/search/index.ts`, `src/lib/server/search/index.test.ts`, `src/lib/server/search/index.db.test.ts` (new)
**Commit:** c6570ac (shared with WR-04)
**Status:** fixed: requires human verification (logic)
**Applied fix:** New optional dep `loadVectorFingerprint`. The singleton implements it as `count(*):max(updated_at)` over `agent_embeddings`. It is checked on the existing 30 s recheck cadence, and a change drops `vectorCache` even when the agents fingerprint is unchanged. A test reproduces the race (empty vectors, then embeddings written, agents fingerprint the same) and expects `bm25` then `hybrid`. A DB-backed test runs the real singleton loaders against a temp DB. The fingerprint SQL was checked separately on an empty and a populated table.

### WR-02: Failed or null embedder cached for the process lifetime

**Files modified:** `src/lib/server/search/index.ts`, `src/lib/server/search/embedder.ts`, `src/lib/server/search/index.test.ts`
**Commit:** 4d9652c
**Status:** fixed: requires human verification (logic)
**Applied fix:** A loaded embedder is still memoised. A null or rejected load clears the memo and sets a retry time with exponential backoff (60 s doubling, capped at 15 min; both configurable via deps). The warm-up and the next search after the backoff start a new, non-blocking attempt. `embedder.ts` now warns once per attempt instead of once per process. Tests cover recovery after two failures, no retry inside the backoff window, the backoff cap, and rejection.

### WR-03: Unvalidated `page` parameter

**Files modified:** `src/lib/catalogUrl.ts`, `src/routes/catalog/+page.server.ts`, `src/lib/catalogUrl.test.ts`, `src/routes/catalog/catalog.test.ts`, `src/routes/catalog/catalog.scale.test.ts`
**Commit:** e458953
**Applied fix:** `parsePage` (radix 10) turns NaN, non-numeric and values below 1 into 1, and caps huge values at 1,000,000 so OFFSET stays a safe integer. It is used in both branches (including the pre-existing non-search one). I put it in `catalogUrl.ts` because SvelteKit rejects extra exports from `+page.server.ts`. Tests cover unit cases, mocked offset values, and a real DB: `?page=abc` used to 500 and now returns page 1.

### WR-04: Server uses stored vectors without checking content

**Files modified:** `src/lib/server/search/index.ts`, `src/lib/server/search/index.test.ts`
**Commit:** c6570ac (shared with WR-01)
**Status:** fixed: requires human verification (logic)
**Applied fix:** `loadVectors` rows now carry `contentHash` (required in the dep type). `vectorsFor` keeps a vector only if `contentHash(model, currentSearchText)` matches. The current text is remembered per slug when the BM25 index is built. Rows with a malformed blob or a length other than `EMBEDDING_DIM` are skipped individually (IN-05, third bullet). Tests: all hashes stale gives bm25, mixed keeps only the valid vector, bad blobs are skipped and the result is cached.

### WR-05: ASCII-only tokenizer

**Files modified:** `src/lib/server/search/tokenize.ts`, `src/lib/server/search/embedder.fake.ts`, `src/lib/server/search/tokenize.test.ts`, `src/lib/server/search/bm25.test.ts`
**Commit:** d399c63
**Applied fix:** `toLowerCase().normalize('NFKC').split(/[^\p{L}\p{M}\p{N}-]+/u)`. I added `\p{M}` to the review's class so combining marks do not split words in scripts that need them. The fake embedder got the same split for parity. Existing ASCII expectations are unchanged. New tests cover Finnish, Cyrillic, CJK, decomposed vs composed forms, and BM25 matching with prefix on non-ASCII terms.

### WR-06: SearchBar and catalog state desync on client navigation

**Files modified:** `src/routes/catalog/+page.svelte`, `src/lib/catalogUrl.ts`, `src/lib/components/SearchBar.svelte`, `src/lib/catalogUrl.test.ts`, `src/lib/components/SearchBar.test.ts`, `src/routes/catalog/page.test.ts` (new)
**Commit:** aeef9f4
**Status:** fixed: requires human verification (browser feel)
**Applied fix:** `selectedCategory`, `selectedLlm`, `selectedMaturity` and `query` are now `$derived` from `data.filters` (assignable in Svelte 5.54, so the optimistic update on change still works). The redundant client-side `filteredAgents` re-filter is removed. The page-level `afterNavigate` bumps a key on `link` and `popstate` navigations only, which re-creates the SearchBar so it shows the new query. `goto` navigations from the page itself keep the input and its focus; the review's `{#key data.filters.q}` suggestion would have remounted the input on every debounced search. The no-results text uses `data.filters.q`. The new jsdom page test passes; I confirmed the remount tests fail when the `afterNavigate` condition is disabled. Real back/forward and focus behaviour should still be checked in a browser (add to 03-HUMAN-UAT).

### WR-07: Catalog load has no fallback if search throws

**Files modified:** `src/routes/catalog/+page.server.ts`, `src/routes/catalog/+page.svelte`, `src/routes/catalog/catalog.test.ts`
**Commit:** 78a3120
**Applied fix:** `search()` is wrapped in try/catch. On error it logs and falls back to an in-JS substring match (all terms must appear in title, summary, category or tags) over rows already filtered by category, llm and maturity, sorted by title and paginated. The load returns `searchDegraded`, and the page shows a "Search is temporarily limited" notice. This used a JS match instead of SQL `LIKE` to avoid wildcard-escaping issues and new drizzle operators.

### WR-08: Unlimited embedding inference; timeout did not cover embed()

**Files modified:** `src/lib/server/search/index.ts`, `src/lib/server/search/index.test.ts`
**Commit:** 53aa8a6
**Status:** fixed: requires human verification (logic)
**Applied fix:** The 200-character cap (`MAX_QUERY_CHARS`) now lives in `search()`; the routes keep theirs. `embed()` is raced against `embedTimeoutMs` as well. A concurrency cap (`maxConcurrentEmbeds`, default 4) makes extra queries skip the semantic leg and use BM25 only. The slot is released when the inference actually settles, not when we stop waiting. Tests cover a hung embed, a rejecting embed, the cap with slot release, and the length cap seen at the embedder.

### WR-09: Ingest embeds all stale rows in one unchecked batch

**Files modified:** `scripts/ingest.ts`, `src/lib/server/search/embedder.ts`, `scripts/ingest.test.ts`, `src/lib/server/search/embedder.test.ts`
**Commit:** 8fdf2bf
**Applied fix:** Embedding runs in batches of 16 (`EMBED_BATCH_SIZE`). A batch whose vector count differs from its text count is rejected whole. Individual vectors must be `Float32Array`, 384 long and all finite, or they are skipped (retried on the next ingest). Each batch is written in one `db.transaction`. A failing batch does not stop later batches. A `written/failed` line is logged. `embed()` now throws when the tensor size is not `texts x 384` instead of slicing blindly. Tests cover batching (40 agents), wrong count, wrong dimension, undefined or NaN vectors, a failing middle batch, and atomic rollback via a SQLite trigger.

### Security-audit extras

**Files modified:** `src/routes/catalog/+page.svelte`, `src/lib/catalogUrl.ts`, `src/lib/components/SearchBar.svelte` (commit aeef9f4, with WR-06)
**Applied fix:** The no-results message has `break-words` and is capped at 200 code points with an ellipsis (`truncateQuery`). The search input has `maxlength=200`. Tests check the cap, the class, and that markup in `q` renders as text.

### IN-01 and IN-02 (trivial Info items)

**Files modified:** `scripts/ingest.ts`, `scripts/ingest.test.ts`
**Commit:** dbdd60d
**Applied fix:** A warning to run `db:push` when `agent_embeddings` is missing. The SQLite handle is now closed in a `finally`, via a small `ingestInto` split so the diff stays small. The test spies on `Database.prototype.close` and fails without the fix.

## Not done (optional or out of scope)

- WR-08 optional extras: no query-vector LRU cache and no per-IP rate limit on `/api/search`. The review lists both as additional options.
- IN-03 (prefix double-counting) and IN-05 first and second bullets (`mode: 'none'` vs `SearchMode`, `embedder.fake.ts` location) are left as is.
- IN-04 is addressed by the CR-01 chunking, but there is no test with more than 1000 real matches; the mock test covers 1200 slugs across three chunks.

## Skipped Issues

None.

---

_Fixed: 2026-10-12_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
