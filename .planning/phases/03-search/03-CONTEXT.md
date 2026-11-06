# Phase 3: Search - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning
**Mode:** Autonomous (smart discuss auto-accepted recommended answers; see .planning/AUTONOMOUS-DECISIONS.md)

<domain>
## Phase Boundary

Hybrid keyword (BM25) + semantic (cosine over precomputed embeddings) search over the agent catalog, with live search-as-you-type on the catalog page, validated by a labeled 20+ query test set. Covers SRCH-01..03.

</domain>

<decisions>
## Implementation Decisions

### Embeddings
- Local ONNX model via `@huggingface/transformers` (`Xenova/all-MiniLM-L6-v2`, 384-d), generated at ingest time, per STACK.md. No paid/external API.
- Embedder sits behind an `Embedder` interface (`embed(texts): Promise<Float32Array[]>`); tests use a deterministic fake. A fake/hash embedder is NEVER used for production results.
- If the model cannot be loaded (offline/no download), ingest logs a warning, skips embeddings, and search degrades to BM25-only. Build must not fail.
- Embeddings stored as BLOBs in SQLite (new table `agent_embeddings`, drizzle migration), with model id + content hash so unchanged agents are not re-embedded.
- Embedded text: name + short description + tags/category + capabilities.

### Ranking
- BM25 implemented in TS over an in-memory index built at server start (~hundreds of agents; no FTS5 dependency).
- Hybrid = reciprocal rank fusion (k=60) of BM25 and cosine rankings. Short queries (<=2 tokens) weight BM25 higher so exact keywords such as "SQL" always surface.
- Query embedding computed server-side lazily (model loaded once, cached); if unavailable, BM25 only.

### UI / API
- `GET /api/search?q=` returns ranked agent ids + scores; catalog page SearchBar debounces (200ms), cancels stale requests, no submit button, preserves existing filters and `?q=` in URL.
- Empty query shows the normal catalog. No-results state with clear message. Results reuse AgentCard.
- Accessible: labeled input, `role="search"`, live-region result count.

### Validation
- Labeled set of 20+ query->expected-agent pairs in `src/lib/server/search/fixtures`, metric: hit@3 >= 0.8 and MRR reported. Run against BM25 + (when available) real embeddings; unit CI uses the fake embedder only for plumbing tests, accuracy thresholds asserted on BM25 plus a skipped-if-no-model real-embedding test.

### Claude's Discretion
File layout, naming, debounce details, snippet highlighting (optional).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/routes/catalog/+page.server.ts` + `+page.svelte`, `AgentCard.svelte`, `FilterBar.svelte`, `Pagination.svelte`
- `src/lib/server/db.ts` (drizzle + better-sqlite3), `scripts/ingest.ts`, `drizzle/` migrations

### Established Patterns
- Server logic in `src/lib/server/*.ts` with colocated `*.test.ts` (vitest); Svelte 5 + Tailwind 4.

### Integration Points
- Ingest script (embedding step), catalog page load/URL params, new `/api/search` route.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

- Related-agents recommendations from embedding similarity (FEATURES.md v1.x).
- Query-result highlighting beyond basics.

</deferred>
