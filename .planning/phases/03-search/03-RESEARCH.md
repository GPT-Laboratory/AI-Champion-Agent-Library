# Phase 3: Search - Research

**Researched:** 2026-10-12
**Domain:** Hybrid BM25 + local-embedding search over a small SQLite catalog, SvelteKit 2 / Svelte 5
**Confidence:** HIGH (environment test run live; repo code read directly)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Local ONNX model via `@huggingface/transformers` (`Xenova/all-MiniLM-L6-v2`, 384-d), generated at ingest time, per STACK.md. No paid/external API.
- Embedder sits behind an `Embedder` interface (`embed(texts): Promise<Float32Array[]>`); tests use a deterministic fake. A fake/hash embedder is NEVER used for production results.
- If the model cannot be loaded (offline/no download), ingest logs a warning, skips embeddings, and search degrades to BM25-only. Build must not fail.
- Embeddings stored as BLOBs in SQLite (new table `agent_embeddings`, drizzle migration), with model id + content hash so unchanged agents are not re-embedded.
- Embedded text: name + short description + tags/category + capabilities.
- BM25 implemented in TS over an in-memory index built at server start (~hundreds of agents; no FTS5 dependency).
- Hybrid = reciprocal rank fusion (k=60) of BM25 and cosine rankings. Short queries (<=2 tokens) weight BM25 higher so exact keywords such as "SQL" always surface.
- Query embedding computed server-side lazily (model loaded once, cached); if unavailable, BM25 only.
- `GET /api/search?q=` returns ranked agent ids + scores; catalog page SearchBar debounces (200ms), cancels stale requests, no submit button, preserves existing filters and `?q=` in URL.
- Empty query shows the normal catalog. No-results state with clear message. Results reuse AgentCard.
- Accessible: labeled input, `role="search"`, live-region result count.
- Labeled set of 20+ query->expected-agent pairs in `src/lib/server/search/fixtures`, metric: hit@3 >= 0.8 and MRR reported. Run against BM25 + (when available) real embeddings; unit CI uses the fake embedder only for plumbing tests, accuracy thresholds asserted on BM25 plus a skipped-if-no-model real-embedding test.

### Claude's Discretion
File layout, naming, debounce details, snippet highlighting (optional).

### Deferred Ideas (OUT OF SCOPE)
- Related-agents recommendations from embedding similarity (FEATURES.md v1.x).
- Query-result highlighting beyond basics.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SRCH-01 | Natural-language semantic search via cosine on pre-built embeddings | Embedder interface + transformers v4 pipeline (verified working); `agent_embeddings` BLOB table; cosine = dot product on normalized vectors |
| SRCH-02 | Combine semantic with keyword/BM25 for short queries | In-TS BM25 + RRF k=60, BM25 weight boost for <=2 tokens |
| SRCH-03 | Live search-as-you-type | `/api/search` + debounced SearchBar with AbortController; catalog page integration notes below |
</phase_requirements>

## Summary

**Environment verification (done live in a scratch dir, nothing installed in the repo):** Node v22.23.3. `npm i @huggingface/transformers` resolves to **4.3.1** (not 3.8.1 as STACK.md says) with `onnxruntime-node@1.30.0`. Network access to huggingface.co works. The model `Xenova/all-MiniLM-L6-v2` loaded and produced `[2, 384]` normalized embeddings via `pipeline('feature-extraction', ...)` with `{pooling:'mean', normalize:true}`. First run (download + load) took ~90 s; the second run (cached) 465 ms. So it WORKS here, but with two traps:

1. **Install trap:** onnxruntime-node's postinstall (`node ./script/install`) tries to download a large CUDA GPU nupkg from api.nuget.org on linux x64. In my first attempt this hung and was SIGTERM'd after 240 s, failing `npm install`. Setting `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` made install succeed (node_modules in scratch = 571 MB total; heavy). Without it, `npm ci` in the Containerfile/CI may hang or fail offline. Mitigate: set that env var in Containerfile and docs; keep the dependency optional-tolerant (dynamic import in try/catch) so a failed/absent install degrades to BM25-only.
2. **Cache trap:** by default model files cache inside `node_modules/@huggingface/transformers/.cache`, which is wiped by `npm prune`/`npm ci`. Set `env.cacheDir` explicitly (e.g. `./db/models` or `HF_CACHE_DIR`), and that directory must be present at runtime if query embedding is done server-side lazily. The Containerfile runs ingest in the build stage and then `npm prune --omit=dev --ignore-scripts` — so `@huggingface/transformers` must be a regular `dependency` (not dev) and the cache dir must be copied to the runtime image; otherwise runtime query embedding silently falls back to BM25-only (acceptable per CONTEXT but should be a conscious choice; log it once).

Catalog size: only **9 real agent YAMLs** in `data/agents/` (airo, demo-rfi-triage, electrical-panel-scheduler, energy-model-sync, hvac-load-calculator, mep-scope-planner, plumbing-fixture-unit-counter, rfi-triage-assistant, submittal-review-router) plus `fixtures/` subdir (ignored by ingest since readdir is non-recursive and filters by extension... a directory named `fixtures` has no extension so is skipped). With 9 agents, exact brute-force cosine and in-memory BM25 are trivially fast; the 20+ query labeled set must be written against these 9 agents (hit@3 of 0.8 over 9 docs is a weak bar — design queries that are discriminating, include paraphrases with no keyword overlap, and also report hit@1/MRR).

**Primary recommendation:** Implement `src/lib/server/search/{bm25,embedder,hybrid,index}.ts` with pure functions + colocated tests; ingest adds an embedding step guarded by try/catch with a dynamic `import('@huggingface/transformers')`; add `agent_embeddings` to `drizzle/schema.ts` (build uses `drizzle-kit push`, so no migration files are required); catalog page keeps server-side data but calls `/api/search` from a SearchBar and renders results by slug.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @huggingface/transformers | 4.3.1 (verified by `npm i` today; STACK.md says 3.8.1 — stale) | Local ONNX embeddings (Xenova/all-MiniLM-L6-v2, 384-d) | Locked decision. Verified working on Node 22. v3 and v4 share the `pipeline('feature-extraction')` API. Consider pinning `^4.3.1` (or `~3.8.1` if planner prefers STACK.md; I verified only 4.3.1) |
| better-sqlite3 / drizzle-orm | existing (^12.8 / ^0.45) | Store embeddings as BLOB | already in repo |
| (none) BM25 | hand-written ~60 lines | Keyword ranking | Locked: no FTS5/library |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.1 (existing) | Tests | all unit tests; `include` already covers `src/**/*.test.ts` |
| @testing-library/svelte + jsdom | existing | SearchBar component test | component tests under `src/lib/components/` run in jsdom automatically |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-TS BM25 | SQLite FTS5 | Locked out. |
| Server-side query embedding | Browser WASM | Locked: server-side. |

**Installation:**
```bash
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install @huggingface/transformers
```
Add the env var to the Containerfile `npm ci` line (line ~26) and README. Do NOT run this install inside the repo before the plan task says so.

## Architecture Patterns

### Recommended Project Structure
```
src/lib/server/search/
├── tokenize.ts          # lowercase, split on non-alnum, simple stopwords, optional light stemming
├── bm25.ts              # buildBm25Index(docs), search(index, query) -> ranked [{slug, score}]
├── embedder.ts          # Embedder interface, createTransformersEmbedder() (dynamic import), cosine(), blob<->Float32Array
├── hybrid.ts            # rrf(rankings, weights, k=60), hybridSearch({query, bm25, embeddings, embedder})
├── documents.ts         # buildSearchText(agentRow) shared by ingest AND index (single source of truth + contentHash)
├── index.ts             # lazy singleton: loads agents + embeddings from db, builds BM25 index, exposes search(q)
├── fixtures/queries.ts  # labeled set (>=20)
└── *.test.ts
src/routes/api/search/+server.ts
src/lib/components/SearchBar.svelte (+ .test.ts)
scripts/embed.ts or step inside scripts/ingest.ts
```

### Pattern 1: Embedder interface with graceful degradation
```typescript
export interface Embedder { id: string; embed(texts: string[]): Promise<Float32Array[]> }

let extractorP: Promise<any> | null = null
export async function createTransformersEmbedder(): Promise<Embedder | null> {
  try {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = process.env.HF_CACHE_DIR ?? './db/models'
    extractorP ??= pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
    const ex = await extractorP
    return {
      id: 'Xenova/all-MiniLM-L6-v2',
      async embed(texts) {
        const out = await ex(texts, { pooling: 'mean', normalize: true }) // Tensor dims [n,384]
        const d = out.data as Float32Array
        return texts.map((_, i) => d.slice(i * 384, (i + 1) * 384))
      },
    }
  } catch (e) { console.warn('[search] embeddings unavailable:', (e as Error).message); extractorP = null; return null }
}
```
Verified: output `dims [2,384]`, `data.length 768`. Normalized => cosine = dot product. Store as `Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength)`; read with `new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength/4)` (copy via `.slice()` first to avoid alignment errors: better-sqlite3 Buffers are not guaranteed 4-byte aligned).

### Pattern 2: RRF with weights
`score(d) = sum_r w_r / (60 + rank_r(d))` with ranks 1-based; only include docs appearing in the ranking. For BM25, include only docs with score > 0 (otherwise zero-score docs get ranks and pollute). For cosine, apply a minimum similarity floor (e.g. 0.2, tune on the labeled set) so nonsense queries can reach the "no results" state; otherwise with 9 agents every query returns all 9. Weights: tokens<=2 -> bm25 1.0 / sem 0.5 (planner may tune); else 1.0/1.0. Edge: with BM25-only fallback, return BM25 ranking directly.

### Pattern 3: Embedding staleness
`contentHash = sha256(modelId + '\n' + buildSearchText(row))`. Table `agent_embeddings(slug PK -> agents.slug, model text, content_hash text, vector blob, updated_at text)`. Ingest: compute hash, skip if row exists with same hash+model; delete embeddings for slugs no longer ingested. Embeddings must be generated AFTER the agents upsert so FK/slug exist.

### Pattern 4: Catalog integration (existing code facts)
- `src/routes/catalog/+page.server.ts` loads max 24 agents with server-side category/llm/maturity filters + pagination via URL params; `+page.svelte` ALSO re-filters client side and `goto('?...', {replaceState:true})` in `syncUrl()`, which rebuilds params from scratch — it will DROP `q` unless updated. Update `syncUrl` to include `q`.
- Simplest robust design: `/api/search?q=` returns `{ results: [{slug, score}], mode: 'hybrid'|'bm25' }`. Catalog page keeps `data.agents`; but data.agents is only the current page (24) and filtered. With ~9 agents this is fine, but correct design: when `q` is non-empty, `+page.server.ts` should ALSO support `q` (call search index, then apply filters and order by rank, paginate) so `?q=` URLs are shareable/SSR-correct; the SearchBar then updates URL (`goto` with `replaceState`, `keepFocus: true`, `noScroll: true`) and `/api/search` is used for live results. Recommend: SearchBar fetches `/api/search`, and page maps returned slugs onto agents (fetch full rows by slug from a shared helper) — planner should choose ONE path; simplest: let `load` handle `q` and have the client use `goto(?q=…, {replaceState, keepFocus, noScroll})` plus `/api/search` still provided for API consumers/tests. Beware: `goto` triggers load re-run with a round trip, fine at this scale; stale responses are handled by SvelteKit. If using fetch directly, use `AbortController` and ignore aborted errors.
- AgentCard props: agent object with slug,title,summary,tags,category etc. (see `AgentCard.svelte`); reuse unchanged.
- `src/lib/server/db.ts` exports `db`, `agents` (schema imported from `../../../drizzle/schema.js`); add `agentEmbeddings` export there.
- Ingest `scripts/ingest.ts` exports `ingest(dataDir, dbPath)` and uses env `INGEST_DATA_DIR`/`INGEST_DB_PATH`; after `sqlite.close()`-preceding loop add embedding step using the same `sqlite`/`db`. Existing tests may mock/call `ingest` — embedding step must be skipped quickly/safely in tests (env `SEARCH_EMBEDDINGS=off` or injected embedder param, `ingest(dataDir, dbPath, { embedder })`).
- Schema: `drizzle.config.ts` has `out: './migrations'` and `npm run build/dev` use `drizzle-kit push` — there is no `drizzle/` migrations folder (only `drizzle/schema.ts`). Adding the table to `drizzle/schema.ts` is sufficient; "drizzle migration" in CONTEXT is satisfied by push. Do not hand-write SQL migrations.

### Anti-Patterns to Avoid
- Importing `@huggingface/transformers` statically at module top (breaks the whole server/ingest when native binding missing). Always dynamic import in try/catch.
- Loading the model at server start synchronously — lazy + cached promise; BM25 must answer immediately while model warms (first server-side load ~0.5 s cached, ~90 s if downloading!). Never block a request on a download: if the model isn't loaded within e.g. 1.5 s, answer BM25-only for that request and let warm-up continue (or warm up at server start in background).
- Using the hash/fake embedder in production code paths.
- Returning all docs for zero-signal queries.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Text embeddings | custom vectorizer | transformers pipeline | locked |
| Mean pooling/normalization | manual | `{pooling:'mean', normalize:true}` option | built in |
| Request cancellation | custom flags | `AbortController` | standard |
| Debounce | heavy library | 10-line `setTimeout`/`clearTimeout` in the component | no dep needed |
| Content hash | custom | `node:crypto` sha256 | built in |

## Common Pitfalls

### Pitfall 1: npm install hangs on CUDA download
**What goes wrong:** `npm ci`/install hangs/fails at onnxruntime-node postinstall downloading `microsoft.ml.onnxruntime.gpu.linux` from nuget (observed, SIGTERM after 240 s).
**How to avoid:** `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` in Containerfile, README, and CI. Since install failure fails the whole `npm ci`, document it prominently; consider `optionalDependencies` is NOT a fix for the postinstall of a transitive dep.
**Warning signs:** install stuck on "Downloading https://api.nuget.org/...".

### Pitfall 2: Model cache lost / first-run 90 s download
Set `env.cacheDir`; pre-warm during ingest (build time) so runtime never downloads. In the container the runtime stage needs the cache dir copied and the package kept in prod deps.

### Pitfall 3: Float32 BLOB alignment
Buffer from better-sqlite3 may have odd byteOffset; `new Float32Array(buf.buffer, buf.byteOffset, n)` can throw. Copy: `new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))`.

### Pitfall 4: `syncUrl` drops `q`; `page` reset
Existing `syncUrl()` rebuilds params without `q`. Also changing q must reset `page=1`.

### Pitfall 5: Vitest + dynamic native import
Never import the real transformers pipeline in default unit tests; real-embedding test uses `describe.skipIf(!modelAvailable)` where availability is determined by an env flag (`SEARCH_REAL_EMBEDDINGS=1`) rather than attempting a download in CI.

### Pitfall 6: Tiny corpus
9 docs means RRF ranks are volatile and hit@3 is easy (3/9 = 33% random). Make labeled queries include paraphrases (e.g. "help me with HVAC sizing" -> hvac-load-calculator; "which regulations apply to my AI system" -> airo; "triage requests for information on site" -> rfi-triage-assistant; note there are two RFI-ish agents: rfi-triage-assistant and demo-rfi-triage, and several project-management agents — decide expected sets (allow multiple acceptable slugs per query)). Verify actual slugs/titles/summaries from the YAMLs when writing fixtures; slugs come from `normalize()` (check `record.slug`, may differ from `id`). Also keep fixtures resilient: when the catalog grows, tests should read from `data/agents` YAMLs via the normalizer, not from the live DB.

### Pitfall 7: Svelte `$state` from props
Existing page initializes `$state(data.filters.category ?? '')` once; navigation via `goto` re-runs load but doesn't reinitialize state (fine with `replaceState` as component persists). Initialize `query` the same way from `data.filters.q`/URL.

## Code Examples

### BM25 (Okapi, k1=1.2, b=0.75)
```typescript
// idf = ln(1 + (N - df + 0.5)/(df + 0.5))  (non-negative variant)
// score = sum_t idf * tf*(k1+1) / (tf + k1*(1 - b + b*dl/avgdl))
```
Weight title/tags higher by repeating title tokens x3, tags x2 in the doc token stream (simple, no BM25F needed). Support prefix matching for the last query token to make search-as-you-type feel live ("hva" -> "hvac"): treat last token as prefix against vocabulary and score as union of matching terms (lower weight). Tokenizer should keep tokens like "sql", "ai-act" split to "ai","act" and also keep the joined form.

### Debounced SearchBar (Svelte 5)
```svelte
<script lang="ts">
  let { value = '', onsearch, count = null }: { value?: string; onsearch: (q: string) => void; count?: number | null } = $props()
  let q = $state(value)
  let t: ReturnType<typeof setTimeout>
  function input() { clearTimeout(t); t = setTimeout(() => onsearch(q.trim()), 200) }
</script>
<div role="search">
  <label for="agent-search" class="sr-only">Search agents</label>
  <input id="agent-search" type="search" bind:value={q} oninput={input} placeholder="Search agents…" />
  <p aria-live="polite" class="sr-only">{count === null ? '' : `${count} agents found`}</p>
</div>
```
Parent fetch: `ctrl?.abort(); ctrl = new AbortController(); fetch('/api/search?q='+encodeURIComponent(q), {signal: ctrl.signal})`; swallow `AbortError`. Component test with `vi.useFakeTimers()` asserting a single call after 200 ms.

### API route
```typescript
// src/routes/api/search/+server.ts
import { json } from '@sveltejs/kit'
export const GET = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200)
  if (!q) return json({ results: [], mode: 'none' })
  const { results, mode } = await search(q)   // never throws; falls back to bm25
  return json({ results: results.map(r => ({ slug: r.slug, score: r.score })), mode })
}
```
Check existing `src/hooks.server.ts` auth: confirm `/api/search` and `/catalog` are allowed under the same auth rules as the catalog (read hooks before wiring; unauthenticated catalog access presumably matches catalog page).

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| @xenova/transformers v2 | @huggingface/transformers v3/v4 (4.3.1 latest today) | Import name; STACK.md version 3.8.1 stale |
| default cache in node_modules | set `env.cacheDir` | persistence across installs |

## Open Questions

1. **Pin v3.8.1 or v4.3.1?** Only 4.3.1 verified here. Recommend `^4.3.1`. Confidence MEDIUM that v3 behaves identically.
2. **Does the Containerfile builder stage have network?** If not, ingest embeds nothing and image is BM25-only (by design). Planner should add a task to document/choose pre-seeding `HF_CACHE_DIR`.
3. **Cosine similarity floor value** — tune on labeled set once real embeddings are run; default 0.25 as starting guess (LOW confidence, unverified).
4. **Catalog data path (load vs. fetch)** — see Pattern 4; recommend load handles `q`, `/api/search` is the live endpoint.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.0 (+ jsdom/@testing-library/svelte for components) |
| Config file | `/home/ville/projects/aic-agent-library/vitest.config.ts` (includes `src/**/*.test.ts`, `scripts/**/*.test.ts`) |
| Quick run command | `npx vitest run src/lib/server/search` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SRCH-01 | cosine/blob roundtrip, embedder interface w/ fake, embedding skip on unchanged hash, ingest degrades when embedder null | unit | `npx vitest run src/lib/server/search/embedder.test.ts scripts/ingest.test.ts` | Wave 0 |
| SRCH-01 | real-model labeled accuracy (hit@3>=0.8, MRR reported) | integration, skipIf no `SEARCH_REAL_EMBEDDINGS=1` | `SEARCH_REAL_EMBEDDINGS=1 npx vitest run src/lib/server/search/accuracy.real.test.ts` | Wave 0 |
| SRCH-02 | BM25 ranks exact keyword ("SQL"-style single token) first; RRF weights; BM25-only fallback; zero-score exclusion | unit | `npx vitest run src/lib/server/search/bm25.test.ts src/lib/server/search/hybrid.test.ts` | Wave 0 |
| SRCH-02 | labeled 20+ set on BM25: hit@3 >= 0.8, MRR printed | unit | `npx vitest run src/lib/server/search/accuracy.test.ts` | Wave 0 |
| SRCH-03 | SearchBar debounce 200ms, aria (role=search, label, live region); API route returns ranked results; empty q; URL keeps q | component + unit | `npx vitest run src/lib/components/SearchBar.test.ts src/routes/api/search` | Wave 0 |
| SRCH-03 | catalog page no-results state, filters preserved | component/unit | `npx vitest run src/routes/catalog` | partial (catalog.test.ts exists) |

### Sampling Rate
- Per task commit: `npx vitest run src/lib/server/search`
- Per wave merge: `npm test`
- Phase gate: full suite green; real-embedding accuracy run recorded once manually (model is downloadable here, ~90 s first run).

### Wave 0 Gaps
- [ ] `src/lib/server/search/*.test.ts`, `fixtures/queries.ts` (20+ labeled queries over the 9 real agents)
- [ ] `src/lib/components/SearchBar.test.ts`
- [ ] `scripts/ingest.test.ts` additions (check whether file exists; ingest accepts injected embedder)
- [ ] Framework install: none (vitest present); `@huggingface/transformers` install with CUDA skip env var

## Sources

### Primary (HIGH confidence)
- Live test in scratch dir (this session): npm install, pipeline run, timings, `npm ls`
- Repo files: `package.json`, `drizzle/schema.ts`, `drizzle.config.ts`, `scripts/ingest.ts`, `src/routes/catalog/+page.server.ts`, `+page.svelte`, `src/lib/server/db.ts`, `Containerfile`, `vitest.config.ts`, `.planning/research/STACK.md`

### Secondary / Tertiary
- None consulted for Svelte/BM25 patterns beyond training knowledge (BM25 formula and RRF are standard; MEDIUM-HIGH confidence).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - verified live
- Architecture: MEDIUM-HIGH - based on reading the repo; catalog data-path choice left to planner
- Pitfalls: HIGH for install/cache (observed), MEDIUM for others

**Research date:** 2026-10-12
**Valid until:** 2026-11-12
