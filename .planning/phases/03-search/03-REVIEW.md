---
phase: 03-search
reviewed: 2026-10-12T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/lib/server/search/bm25.ts
  - src/lib/server/search/documents.ts
  - src/lib/server/search/embedder.ts
  - src/lib/server/search/embedder.fake.ts
  - src/lib/server/search/hybrid.ts
  - src/lib/server/search/index.ts
  - src/lib/server/search/tokenize.ts
  - src/routes/api/search/+server.ts
  - src/routes/catalog/+page.server.ts
  - src/routes/catalog/+page.svelte
  - src/lib/components/SearchBar.svelte
  - scripts/ingest.ts
  - drizzle/schema.ts
  - src/hooks.server.ts
findings:
  critical: 1
  warning: 8
  info: 5
  total: 14
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-10-12
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Reviewed the search service (BM25, hybrid RRF, embedder, lazy index), the `/api/search` route, the catalog load and page, SearchBar, the ingest embedding step, the schema, and the hooks warm-up. Test files were not reviewed. `src/lib/server/db.ts` was read for context.

There is no SQL injection. All queries go through drizzle with bound parameters. `inArray` is bounded to at most 50 slugs by the hard-coded `limit = 50` in `hybridSearch`, so the SQLite variable limit is not hit today. That bound is implicit (see IN-04). Query length is capped to 200 characters at both route entry points, and the tokenizer regexes are linear on bounded input.

The main problems are correctness:

- Search results are truncated to the top 50 before filters and pagination, so `total` and the filtered results are wrong for broad queries.
- The vector cache can go stale, and a failed embedder load is cached permanently.
- Embeddings are not verified against content on the server side.

## Critical Issues

### CR-01: Search truncates to top 50 before filters and pagination, so filtered results and `total` are wrong

**File:** `src/lib/server/search/hybrid.ts:40,61`, `src/routes/catalog/+page.server.ts:37-51`
**Issue:** `hybridSearch` defaults to `limit = 50`, and the catalog page calls `search(q)` with no override. The category, llm and maturity filters are applied afterwards in SQL, against only those 50 slugs. Consequences:
- With a filter active, any agent matching both the query and the filter but ranked below 50 overall is silently dropped. A catalog of 150 or more agents with a broad query plus `category=X` returns incomplete results.
- `total` is `matched.length`, so it never exceeds 50. Pagination shows at most 3 pages, and the SearchBar live region announces "50 agents found" when more match.
- `catalog.scale.test.ts` does not cover a broad query plus filter at scale, so this passes tests.

**Fix:** Do not cap by the fused limit when the caller will filter. Options:
```ts
// index.ts
search(q: string, opts?: { limit?: number })   // pass through to hybridSearch
// +page.server.ts
const { results } = await search(q, { limit: Infinity })
```
Then page after filtering, which is already done via `matched.slice`. Alternatively, pass `conditions` into the search service and filter slugs before ranking. Note that `inArray` with an unbounded slug list would hit SQLite's bound-variable limit of 32766 on older builds and 250000 on newer ones. Either chunk the list, or load filtered rows with `whereClause` and intersect with the ranking in JS:
```ts
const rows = db.select().from(agents).where(whereClause).all()
const rank = new Map(slugs.map((s, i) => [s, i]))
const matched = rows.filter(r => rank.has(r.slug)).sort((a, b) => rank.get(a.slug)! - rank.get(b.slug)!)
```

## Warnings

### WR-01: Vector cache goes stale after ingest (race between agent upsert and embedding write)

**File:** `src/lib/server/search/index.ts:56-82`
**Issue:** `vectorCache` is reset only when the agents fingerprint (`count:max(lastIngestedAt)`) changes. `ingest` upserts all agent rows first and writes embeddings last in `embedAgents`, which can take minutes on the first model load. If the server's 30s recheck runs between those two steps:
1. `refresh()` sees the new fingerprint and clears `vectorCache`.
2. `vectorsFor()` loads the old or missing vectors and caches them.
3. The embeddings are then written, but the agents fingerprint no longer changes, so the cache is never invalidated until the next ingest or a restart.

An empty cache is possible too. `vectors.size === 0` then skips embedding the query, so mode degrades to `bm25` indefinitely.

**Fix:** Include an embeddings fingerprint in the invalidation key, for example `SELECT count(*), max(updated_at) FROM agent_embeddings`. Check it on the same `recheckMs` cadence. Alternatively, do not cache an empty or partial vector set. Or have ingest write the embeddings before bumping `last_ingested_at`.

### WR-02: A failed or null embedder is cached for the process lifetime

**File:** `src/lib/server/search/index.ts:47-54`, `src/lib/server/search/embedder.ts:54-61`
**Issue:** `ensureEmbedder` memoises its promise. `createTransformersEmbedder` returns `null` on any failure, including a transient network error during the model download, and that `null` is memoised. The warm-up in the `hooks.server.ts` `init` hook triggers this at boot. One failed download at startup means hybrid search never recovers without a restart. The warning is also printed only once (`warned`). `embedTimeoutMs` (1.5s) only races this promise. A slow first load makes early queries BM25-only, which is fine, but a resolved `null` is permanent.
**Fix:** Do not memoise a `null` result. Reset `embedderPromise` when it resolves to `null`, with a backoff such as retrying no more often than every 60s:
```ts
embedderPromise = Promise.resolve().then(() => deps.getEmbedder()).catch(() => null)
  .then(e => { if (!e) { setTimeout(() => (embedderPromise = null), RETRY_MS) } return e })
```

### WR-03: Unvalidated `page` parameter gives a 500 or wrong results

**File:** `src/routes/catalog/+page.server.ts:9,51,60`
**Issue:** `parseInt(url.searchParams.get('page') ?? '1')` has no radix, no NaN check and no lower bound.
- `?page=abc` gives `offset(NaN)`. better-sqlite3 rejects it with `datatype mismatch` (verified), so the non-search branch returns a 500. Anyone can trigger this.
- In the search branch, `page=0` or a negative page gives `slice(-24, 0)` or a negative-index slice. That returns an empty or wrong window, and `data.page` echoes the negative value to Pagination.
- A page past the last page shows the "No agents match" message.

The `page` parsing is older code, but the new search branch makes the failure mode worse.

**Fix:**
```ts
const rawPage = Number.parseInt(url.searchParams.get('page') ?? '1', 10)
const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1
```
Optionally clamp to `totalPages` after computing the total.

### WR-04: Server uses stored vectors without checking they match current content

**File:** `src/lib/server/search/index.ts:73-82`, `scripts/ingest.ts:61-77,89-97`
**Issue:** `contentHash` is stored but never checked at query time. If ingest runs with `SEARCH_EMBEDDINGS=off`, or with the model unavailable (`embedAgents` returns early), agent text changes are written to `agents`. The old vectors stay in `agent_embeddings` with the old hash and the same model, and `vectorsFor` serves them for the updated text. BM25 uses the new text and the semantic ranking uses the old text, so the two rankings silently disagree. Agents never embedded are simply missing from the semantic ranking.
**Fix:** In `vectorsFor`, recompute `contentHash(model, buildSearchText(rowToSearchable(row)))` per row and skip vectors whose hash differs. `loadAgents` already has the rows. The loader must also select `contentHash`, since `loadVectors` returns it via `select()` but the `SearchServiceDeps` type omits it.

### WR-05: ASCII-only tokenizer destroys non-ASCII text

**File:** `src/lib/server/search/tokenize.ts:13`
**Issue:** `split(/[^a-z0-9-]+/)` treats every accented or non-Latin character as a separator. Finnish `ä` and `ö` split words, so `päätös` becomes `p` and `t`, which are dropped as 1-character tokens. A query such as `työkalu` becomes `ty`, `kalu`. CJK or Cyrillic queries and documents tokenise to nothing. In BM25-only mode, or when the embedder times out, a non-ASCII query returns zero or garbage results. The project is at a Finnish university, so this is plausible input.
**Fix:** Use Unicode classes and normalise:
```ts
text.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}-]+/u)
```
Optionally strip diacritics via NFD plus `\p{M}` removal, and apply the same to the fake embedder for parity.

### WR-06: SearchBar and catalog state desync on client navigation

**File:** `src/lib/components/SearchBar.svelte:10-12`, `src/routes/catalog/+page.svelte:13-16`
**Issue:** `text` in SearchBar and the `selectedCategory`, `selectedLlm`, `selectedMaturity` and `query` state in the page are initialised once from `data.filters`. They are never re-synced when `data` changes for a navigation that does not remount the page. Examples: clicking a "Catalog" nav link from `/catalog?q=foo`, or browser back and forward, since the URL sync uses `replaceState` only for in-page edits. After such a navigation the input still shows `foo` while the list is unfiltered. The page's client-side `filteredAgents` re-filters with the stale `selected*` state, so it can hide agents the server returned. The "No agents match "{query}"" message also uses the stale `query` rather than `data.filters.q`.
**Fix:** Derive the state from `data.filters`. For example, key the SearchBar on the committed value (`{#key data.filters.q}`) and re-seed the selections in an `$effect` when `data.filters` changes. Drive the empty-state message from `data.filters.q`. Remove the redundant client-side `filteredAgents` filtering now that the server filters.

### WR-07: Catalog load has no fallback if search throws

**File:** `src/routes/catalog/+page.server.ts:37`
**Issue:** `/api/search` wraps `search()` in try/catch. The catalog `load` calls `await search(q)` unguarded. If the index build (`loadAgents`) or the dynamic db import throws, the whole catalog page 500s, including for a plain `?q=` request. The broken dependency should degrade search, not take down browsing.
**Fix:** Catch the error, log it, and treat it as an empty result or fall back to a SQL `LIKE` on the title or summary. Surface a notice to the user.

### WR-08: Unauthenticated search can run unlimited embedding inference, and the timeout does not cover it

**File:** `src/lib/server/search/index.ts:84-120`, `src/routes/api/search/+server.ts:6`
**Issue:** `isAuthenticationEnabled()` can be false, in which case `hooks.server.ts` skips auth entirely. Every distinct `q` of up to 200 characters then runs an ONNX inference with no rate limit, no concurrency limit and no query-vector cache. `embedTimeoutMs` races only `ensureEmbedder()`. The actual `embedder.embed([query])` call is awaited with no timeout, so a slow or hung inference blocks the request indefinitely. The 200-character cap lives only in the two route handlers. `search()` itself accepts arbitrary-length input, so any new caller bypasses the cap.
**Fix:**
- Enforce the length cap inside `createSearchService.search` as well as in the routes.
- Wrap `embedder.embed` in the same timeout race.
- Add a small LRU cache for query vectors.
- Apply a coarse per-IP rate limit on `/api/search` when auth is disabled.

### WR-09: Ingest embeds all stale rows in one unchecked batch

**File:** `scripts/ingest.ts:99-121`, `src/lib/server/search/embedder.ts:42-52`
**Issue:**
- All stale texts go into one `embedder.embed` call. On a large catalog this pads every item to the longest and loads everything into memory at once.
- Nothing checks `vectors.length === stale.length` or that each vector has length `EMBEDDING_DIM`. `embed()` slices `data.subarray(i * 384, (i + 1) * 384)` blindly. A different tensor shape yields truncated vectors, which are stored as BLOBs, and `cosine` then returns 0 on length mismatch, silently disabling semantic search for those rows.
- If `vectors[i]` is undefined, `vectorToBlob(undefined)` throws. The outer catch swallows it, leaving a partially written set with no clear failure signal.
- The per-row `await db.insert` loop is not in a transaction.

**Fix:** Batch (for example 16 to 32 texts per call). Validate `v.length === EMBEDDING_DIM` and the batch length. Wrap the writes in `sqlite.transaction`. Log how many rows were embedded and how many failed.

## Info

### IN-01: Silent skip when `agent_embeddings` table is missing

**File:** `scripts/ingest.ts:62-65`
**Issue:** `if (!hasTable) return` produces no log. The user gets no hint that `db:push` is needed, and semantic search is silently off.
**Fix:** Add `console.warn('[search] agent_embeddings table missing; run db:push')`.

### IN-02: SQLite handle not closed on error paths in ingest

**File:** `scripts/ingest.ts:132-200`
**Issue:** `sqlite.close()` is only reached on the happy path. `readdir` or `readFile` failures (the `readFile` sits outside the try) leave the handle open. The CLI process exits, but programmatic callers and tests leak it.
**Fix:** Use `try { ... } finally { sqlite.close() }`.

### IN-03: Prefix expansion double-counts terms already in the query

**File:** `src/lib/server/search/bm25.ts:71-80`
**Issue:** For the query `database data`, the last token is `data`. The term `database` is an exact query token at weight 1. It is also a prefix match of `data` and gets another 0.5 weight. Minor ranking skew.
**Fix:** Skip terms already present in `tokens`: `if (term !== last && !tokenSet.has(term) && term.startsWith(last))`.

### IN-04: The `inArray` bound is implicit

**File:** `src/routes/catalog/+page.server.ts:46`
**Issue:** The safety of `inArray(agents.slug, slugs)` depends on `hybridSearch`'s default `limit = 50`. Fixing CR-01 by raising or removing the limit can hit SQLite's bound-variable cap.
**Fix:** If the limit is lifted, chunk the slug list or use the JS intersection approach in CR-01. Add a test with more than 1000 matches.

### IN-05: Minor inconsistencies and leftovers

**File:** `src/routes/api/search/+server.ts:7`, `src/lib/server/search/index.ts:103`, `src/lib/server/search/embedder.fake.ts`, `src/lib/server/search/index.ts:77,110`
**Issue:**
- The empty-query response returns `mode: 'none'` from the API, but `'bm25'` from the service. `SearchMode` does not include `'none'`.
- `embedder.fake.ts` lives in production source (`src/lib/server/search`) and is guarded only by a comment.
- If a stored vector has a `byteLength` that is not a multiple of 4, `blobToVector` throws a `RangeError`. The error is caught in `search`, but `vectorCache` is never set, so the full vector table is re-read and re-parsed on every query until fixed.
- `parseInt` calls lack a radix.

**Fix:** Align the mode values and widen the type. Move the fake embedder under a test-only path or `fixtures/`. Cache the failure, or skip individual malformed rows with try/catch inside the loop.

---

_Reviewed: 2026-10-12_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
