# Phase 3: Search - Pattern Map

**Mapped:** 2026-10-12
**Files analyzed:** 22 (14 new, 8 modified)
**Analogs found:** 19 / 22 (all analogs verified git-tracked via `git ls-files`)

Repo conventions observed (no CLAUDE.md exists): SvelteKit 2 + Svelte 5 runes, ESM TS, no semicolons, single quotes, 2-space indent. Server code in `src/lib/server/*.ts` with colocated `*.test.ts` (vitest). Server imports use `$lib/server/db.js` aliases in routes, relative imports inside `src/lib/server`, and `../drizzle/schema.js` / `../src/lib/...js` in `scripts/`. `src/lib/components/**/*.test.ts` run in jsdom via the `// @vitest-environment jsdom` first-line pragma; vitest includes `src/**/*.test.ts` and `scripts/**/*.test.ts`. DB is created by `drizzle-kit push` (no migration folder), so schema additions go in `drizzle/schema.ts` only.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `drizzle/schema.ts` (MOD: add `agentEmbeddings`) | model | CRUD | `drizzle/schema.ts` `agents` table | exact |
| `src/lib/server/db.ts` (MOD: export `agentEmbeddings`) | config | CRUD | itself (line 5, 13) | exact |
| `src/lib/server/search/tokenize.ts` | utility | transform | `src/lib/spec/types.ts` `slugify` (pure string fn) | role-match |
| `src/lib/server/search/bm25.ts` | utility | transform | `src/lib/server/tryitout/clientLimit.ts` (pure factory returning closure object) | role-match |
| `src/lib/server/search/embedder.ts` | service | request-response (+ blob I/O) | `src/lib/server/auth.ts` `getAuthService` (lazy singleton + dynamic `import('./mail')`) and `tryitout/runtimeFake.ts` (interface + fake) | role-match |
| `src/lib/server/search/documents.ts` | utility | transform | `scripts/ingest.ts` `flattenRecord` (row <- record mapper) | role-match |
| `src/lib/server/search/hybrid.ts` | utility | transform | `clientLimit.ts` (pure, injected deps) | role-match |
| `src/lib/server/search/index.ts` | service | request-response (lazy singleton over db) | `src/lib/server/auth.ts` lines 270-285 | role-match |
| `src/lib/server/search/fixtures/queries.ts` | test fixture | batch | `src/lib/server/tryitout/piFixtures.ts` | role-match |
| `src/lib/server/search/*.test.ts` (bm25, embedder, hybrid, accuracy, accuracy.real) | test | transform | `src/lib/server/tryitout/clientLimit.test.ts` | exact |
| `scripts/ingest.ts` (MOD: embedding step, `{ embedder }` param) | script | batch / file-I/O | itself (lines 48-115) | exact |
| `scripts/ingest.test.ts` (MOD: add embedding tests + `agent_embeddings` DDL) | test | batch | itself (lines 1-90) | exact |
| `src/routes/api/search/+server.ts` | route | request-response | `src/routes/api/try-out/+server.ts` (+ `src/routes/health/+server.ts` for GET shape) | exact |
| `src/routes/api/search/search.test.ts` | test | request-response | `src/routes/api/tryitout/jobs/jobs.test.ts` | role-match |
| `src/lib/components/SearchBar.svelte` | component | event-driven | `src/lib/components/FilterBar.svelte` | exact |
| `src/lib/components/SearchBar.test.ts` | test | event-driven | `src/lib/components/FilterBar.test.ts` | exact |
| `src/routes/catalog/+page.server.ts` (MOD: `q` param) | controller | request-response | itself | exact |
| `src/routes/catalog/+page.svelte` (MOD: SearchBar, `syncUrl` keeps `q`, no-results copy, live region) | component | request-response | itself | exact |
| `src/routes/catalog/catalog.test.ts` (MOD) | test | request-response | itself | exact |
| `Containerfile` (MOD: `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`, HF cache copy) | config | n/a | itself lines 26-28, 54-58 | exact |
| `package.json` (MOD: dependency) | config | n/a | itself | exact |
| `README.md` (MOD: install note) | docs | n/a | itself | exact |

## Pattern Assignments

### `drizzle/schema.ts` (model, CRUD)

**Analog:** `drizzle/schema.ts` lines 1-35. Add a sibling table below `agents`; extend the existing import line 3 only if `blob` is needed (`import { sqliteTable, text, integer, real, blob } from 'drizzle-orm/sqlite-core'`).

**Conventions to copy** (lines 6-9, 30-35): camelCase TS key mapped to snake_case column, `text('slug').primaryKey()`, timestamps as ISO text with `sql\`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))\`` default, then exported `$inferSelect`/`$inferInsert` types.

```typescript
export const agentEmbeddings = sqliteTable('agent_embeddings', {
  slug:        text('slug').primaryKey().references(() => agents.slug, { onDelete: 'cascade' }),
  model:       text('model').notNull(),
  contentHash: text('content_hash').notNull(),
  vector:      blob('vector', { mode: 'buffer' }).notNull(),
  updatedAt:   text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
})
export type AgentEmbeddingRow = typeof agentEmbeddings.$inferSelect
```

Note: the `.references()` FK is optional; SQLite FK enforcement is off by default in better-sqlite3 unless `PRAGMA foreign_keys = ON`, so ingest must delete orphan embeddings explicitly (RESEARCH Pattern 3).

### `src/lib/server/db.ts` (config)

**Analog:** itself, lines 5 and 13. Mirror the existing import/re-export:

```typescript
import { agents, agentEmbeddings } from '../../../drizzle/schema.js'
...
export { agents, agentEmbeddings }
```

WARNING: `src/routes/catalog/catalog.test.ts` lines 4-67 `vi.mock('$lib/server/db.js', ...)` returns ONLY `db` and `agents`. Any new module imported (transitively) by `+page.server.ts` that touches `agentEmbeddings` at import time will break that suite unless the mock is extended or the search module is also `vi.mock`ed.

---

### `src/lib/server/search/tokenize.ts`, `bm25.ts`, `hybrid.ts` (utility, transform)

**Analog:** `src/lib/server/tryitout/clientLimit.ts` lines 1-40: header comment explaining server-only intent, exported interface, factory function taking an options object with injectable deps (`now?: () => number`), closure state, no top-level side effects. Pure functions, no I/O, so they are trivially testable.

```typescript
// src/lib/server/tryitout/clientLimit.ts (excerpt, lines 1-20)
// Server-only. Sliding-window cap ...
export interface ClientLimiter {
  tryAdmit(clientKey: string): boolean
}
export function createClientLimiter(opts: { max: number; windowMs: number; now?: () => number }): ClientLimiter {
  const now = opts.now ?? Date.now
  ...
  return { tryAdmit(clientKey) { ... } }
}
```

Apply as: `buildBm25Index(docs: {slug: string; text: string; ...}[]): Bm25Index` returning `{ search(query): {slug, score}[] }`; `rrf(rankings, weights, k = 60)`; `hybridSearch({ query, bm25, embeddings, embedder })` with the embedder injected (never imported statically). `slugify` in `src/lib/spec/types.ts` lines 69-75 is the in-repo precedent for the regex normalization style:

```typescript
export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
}
```

Formulas (BM25 k1=1.2 b=0.75, RRF, prefix-match last token, zero-score exclusion, cosine floor) come from RESEARCH Code Examples / Pattern 2; no codebase analog exists for the math.

---

### `src/lib/server/search/embedder.ts` (service, request-response + blob I/O)

**Analogs:** `src/lib/server/auth.ts` lines 270-285 (lazy module singleton; dynamic `await import('./mail')` inside a callback so the heavy dependency loads only when used) and `src/lib/server/tryitout/runtimeFake.ts` (header comment + interface in one module, deterministic fake exported for tests).

```typescript
// src/lib/server/auth.ts lines 270-284 (lazy singleton + dynamic import precedent)
let service: AuthService | undefined
export function getAuthService(): AuthService {
  if (!service) {
    ...
    service = new AuthService({
      ...
      sendCode: async (email, code) => {
        const { sendLoginCode } = await import('./mail')
        await sendLoginCode(email, code)
      },
    })
  }
  return service
}
```

Copy this shape for `createTransformersEmbedder()` (RESEARCH Pattern 1 gives the body: dynamic `import('@huggingface/transformers')` in try/catch, `env.cacheDir = process.env.HF_CACHE_DIR ?? './db/models'`, cached promise, `console.warn` once, return `null` on failure). Put the fake (`createFakeEmbedder()`, hash-based, deterministic) in a separate clearly-named test-only file (e.g. `embedder.fake.ts`), mirroring `runtimeFake.ts` separation, so production code never imports it. Also export `cosine`, `vectorToBlob`, `blobToVector` (copy via `buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)` for alignment; RESEARCH Pitfall 3).

Env-var config precedent: `src/lib/server/db.ts` line 7 `process.env.CATALOG_DB_PATH ?? './db/catalog.db'`; `src/lib/server/auth.ts` uses `env.X ?? default`. Use `process.env.HF_CACHE_DIR ?? './db/models'` the same way.

---

### `src/lib/server/search/documents.ts` (utility, transform)

**Analog:** `scripts/ingest.ts` `flattenRecord` lines 15-46 (maps a record to a row, JSON.stringify arrays). Inverse direction here: take an `AgentRow`-like object (tags stored as JSON text) and return the embedding text and sha256 hash. Single source of truth used by BOTH ingest and the index.

```typescript
import { createHash } from 'node:crypto'
export function buildSearchText(row: { title: string; summary: string; category: string | null; tags: string; toolNames: string }): string { ... }
export function contentHash(modelId: string, text: string): string {
  return createHash('sha256').update(`${modelId}\n${text}`).digest('hex')
}
```

JSON array columns are parsed as in `src/routes/catalog/+page.server.ts` lines 36-44 (`JSON.parse(row.tags) as string[]`). Embedded text per CONTEXT: name + short description + tags/category + capabilities (`toolNames`).

---

### `src/lib/server/search/index.ts` (service, lazy singleton over db)

**Analog:** `src/lib/server/auth.ts` lines 270-285 for lazy singleton; `src/lib/server/db.ts` for the `db`/`agents` import; `src/routes/api/try-out/+server.ts` lines 44-48 for the drizzle sync read style (`.select().from().all()`/`.get()`, no await).

```typescript
import { db, agents, agentEmbeddings } from '$lib/server/db.js'  // inside src/lib/server use relative './../db.js'
const rows = db.select().from(agents).all()
```

Contract: `search(q): Promise<{ results: {slug, score}[]; mode: 'hybrid' | 'bm25' }>`, never throws, BM25 answers immediately; query embedding raced against ~1.5 s timeout (RESEARCH anti-patterns). Do NOT use the `$lib` alias in a way that breaks plain-node/tsx imports from `scripts/`; `scripts/ingest.ts` imports via relative paths (`../src/lib/spec/index.js`), so `documents.ts` and `embedder.ts` (imported by ingest) must use relative imports only and must not import `db.ts` (which opens `./db/catalog.db` at import, lines 7-10).

---

### `src/lib/server/search/fixtures/queries.ts` (fixture, batch)

**Analog:** `src/lib/server/tryitout/piFixtures.ts` (tracked fixture module consumed by tests). Export `labeledQueries: { query: string; expected: string[] }[]` (multiple acceptable slugs allowed). Real slugs (from `slugify(name)`): `airo`, `demo-rfi-triage`, `electrical-panel-scheduler`, `energy-model-sync`, `hvac-load-calculator`, `mep-scope-planner`, `plumbing-fixture-unit-counter`, `rfi-triage-assistant`, `submittal-review-router`. Build the accuracy test corpus by loading `data/agents/*.yaml` through `detectFormat`/`normalize` (as `scripts/ingest.ts` lines 62-67 do), not the live DB.

```typescript
// scripts/ingest.ts lines 62-67
const raw = parseYaml(content)
const formatId = detectFormat(raw)
const record = normalize(formatId, raw)
```

---

### `src/lib/server/search/*.test.ts` (test, transform)

**Analog:** `src/lib/server/tryitout/clientLimit.test.ts` lines 1-20: plain vitest, `describe`/`it`, injected clock/deps, no mocks needed.

```typescript
import { describe, expect, it } from 'vitest'
import { createClientLimiter } from './clientLimit'
```

For `accuracy.real.test.ts` use `describe.skipIf(process.env.SEARCH_REAL_EMBEDDINGS !== '1')` (RESEARCH Pitfall 5). Never import `@huggingface/transformers` in default tests.

---

### `scripts/ingest.ts` (script, batch) — MODIFY

**Analog:** itself. Facts the planner must respect:
- Line 48 signature `async function ingest(dataDir: string, dbPath: string): Promise<{ succeeded: number; failed: number }>`; add optional third arg `opts?: { embedder?: Embedder | null }` so existing two-arg callers/tests are unchanged.
- Lines 49-52 own the `sqlite`/`db` handles; the embedding step goes after the `for` loop (ends line 109) and before `sqlite.close()` (line 112), reusing `db`/`sqlite`. Embedding must run after agent upserts.
- Error style: per-item try/catch with `console.error(\`[SKIP] ${file}: ${(err as Error).message}\`)` (line 106). Use `console.warn('[search] ...')` and never throw from the embedding step (build must not fail).
- Default embedder resolution: if `opts.embedder === undefined`, call `createTransformersEmbedder()` unless `process.env.SEARCH_EMBEDDINGS === 'off'`. `scripts/ingest.test.ts` currently calls `ingest(FIXTURES_DIR, TEST_DB)` with no embedder, so unless the default is made safe, those tests would try to load the real model (90 s download). Recommend tests pass `{ embedder: null }` or the suite sets `process.env.SEARCH_EMBEDDINGS = 'off'`.
- Upsert idiom to copy for embeddings (lines 69-102): `db.insert(table).values(row).onConflictDoUpdate({ target: table.slug, set: { x: sql\`excluded.x\` } })`.
- Main guard (lines 119-125) unchanged.
- Delete embeddings for slugs not present in `agents` after ingest (`NOT IN` / explicit loop).

### `scripts/ingest.test.ts` (test) — MODIFY

**Analog:** itself lines 9-52. The test pre-creates tables with a hand-written `CREATE_TABLE_SQL` (line 9-36) because it bypasses `drizzle-kit push`. The new `agent_embeddings` table must be added to this DDL (or the embedding step must `CREATE TABLE IF NOT EXISTS`), otherwise the embedding step fails on a missing table. Reuse `TEST_DB`, `beforeEach`/`afterEach` cleanup, and `FIXTURES_DIR` (2 valid + 1 malformed).

```typescript
db.exec(CREATE_TABLE_SQL)   // line 44; add agent_embeddings DDL here
```

---

### `src/routes/api/search/+server.ts` (route, request-response)

**Analogs:** `src/routes/api/try-out/+server.ts` (imports lines 1-8, `RequestHandler` typing line 8/31, `json(...)` responses with `{ message }` bodies, try/catch with `console.error`) and `src/routes/health/+server.ts` (minimal GET).

**Imports + handler pattern** (try-out lines 1, 8, 31, 73-76):
```typescript
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200)
  if (!q) return json({ results: [], mode: 'none' })
  try {
    const { results, mode } = await search(q)
    return json({ results: results.map(r => ({ slug: r.slug, score: r.score })), mode })
  } catch (err) {
    console.error('Search failed', err)
    return json({ message: 'Search failed.' }, { status: 500 })
  }
}
```

**Auth:** nothing to add per route. `src/hooks.server.ts` lines 19-46 already returns 401 JSON for unauthenticated `/api/*` (non-public) when auth is enabled, and passes everything through when auth is disabled. `/api/search` should stay non-public (same as `/catalog`); do NOT add it to `PUBLIC_ROUTES` (line 6) or `PUBLIC_PREFIXES` (line 8). Client `fetch` must treat a 401 as an error state rather than JSON results.

### `src/routes/api/search/search.test.ts` (test)

**Analog:** `src/routes/api/tryitout/jobs/jobs.test.ts` (route test living next to the route; `vi.mock` of lib modules, dynamic import of `./+server`). Mock `$lib/server/search/index.js` and call `GET({ url: new URL('http://localhost/api/search?q=sql') } as Parameters<typeof GET>[0])`, mirroring `catalog.test.ts` line 125-126 (`load({ url } as Parameters<typeof load>[0])`).

---

### `src/lib/components/SearchBar.svelte` (component, event-driven)

**Analog:** `src/lib/components/FilterBar.svelte`: `<script lang="ts">`, `interface Props`, `let { ... }: Props = $props()`, callback props named `onXChange`, labeled controls with `for`/`id`, Tailwind classes, `min-h-[44px]` touch target.

```svelte
<script lang="ts">
  interface Props { ... }
  let { categories, ... , onClear }: Props = $props()
  let hasActiveFilters = $derived(...)
</script>
<label for="filter-category" class="block text-xs font-medium text-gray-700 mb-1">Category</label>
<select id="filter-category"
  class="min-h-[44px] rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
```

Copy the input styling verbatim (`min-h-[44px] rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900`). Use the RESEARCH debounced SearchBar (role="search" wrapper, `<label class="sr-only">`, `<p aria-live="polite" class="sr-only">`). Repo has precedent for `sr-only` (TryOutPanel.svelte line 281) and `role="status"` (TryOutPanel.svelte line 283; login `role="alert"`). Prop naming: use `value`, `onsearch` (or `onSearch` to match `onCategoryChange` camelCase convention), `count`. Clear the pending timeout in an `$effect` cleanup / on destroy.

### `src/lib/components/SearchBar.test.ts` (test)

**Analog:** `src/lib/components/FilterBar.test.ts` lines 1-17, 49-55:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
...
const { container } = render(FilterBar, { ...defaultProps, onCategoryChange })
await fireEvent.change(select, { target: { value: 'devops' } })
expect(onCategoryChange).toHaveBeenCalledWith('devops')
```

Use `fireEvent.input(input, { target: { value: 'sql' } })` + `vi.useFakeTimers()` + `vi.advanceTimersByTime(200)`; assert single call, `role="search"`, label association, live region text.

---

### `src/routes/catalog/+page.server.ts` (controller) — MODIFY

**Analog:** itself. Current facts: params parsed lines 8-11; `conditions` built with `eq`/`and` lines 13-18; paginated `.limit(PAGE_SIZE).offset(...)` lines 20-27; `filters: { category, llm, maturity }` return line 77 (add `q`). Recommended: when `q` non-empty call the search module, then constrain with `inArray(agents.slug, slugs)` (import it from `drizzle-orm`), keep category/llm/maturity conditions, then reorder rows in JS by rank and slice for the page; when empty keep the existing `orderBy(asc(agents.title))` path untouched. `page` must reset to 1 when `q` changes (client side).

IMPORTANT for tests: `catalog.test.ts` lines 70-74 mocks `drizzle-orm` with only `eq`, `and`, `asc`; adding `inArray` to the module requires adding it to that mock (and mocking `$lib/server/search/index.js`) or all existing catalog tests fail at import/call time.

### `src/routes/catalog/+page.svelte` (component) — MODIFY

**Analog:** itself. Facts:
- Lines 11-13: filter state initialized from `data.filters.*` once with `$state(data.filters.x ?? '')`; add `let query = $state(data.filters.q ?? '')` the same way.
- Lines 16-23: client-side `$derived.by` re-filter of `data.agents`; keep.
- Lines 47-54 `syncUrl()` rebuilds params from scratch; MUST add `if (query) params.set('q', query)` or `q` is dropped on any filter change. Keep `goto(\`?${params.toString()}\`, { replaceState: true })`; for search-as-you-type add `keepFocus: true, noScroll: true`.
- Lines 72-76 no-results block: current copy "No agents match your filters"; for a query, show a distinct message (e.g. `No agents match "{query}"`) and keep the `<Pagination>` branch lines 84.
- Lines 59-70 place `<SearchBar>` above `<FilterBar>`; pass `count={filteredAgents.length}` for the live region. Results reuse `<AgentCard {agent} />` (line 80), unchanged.

### `src/routes/catalog/catalog.test.ts` (test) — MODIFY

**Analog:** itself lines 4-67 (hoisted `vi.mock('$lib/server/db.js')` with chain builders), 116-124 (`mockImplementation` call counting: first `db.select()` call = page rows, second = count). Adding a search call or extra `db.select()` call in `load` changes call counting; keep the non-`q` path's select ordering identical, and add new tests for `?q=` by mocking the search module.

---

## Shared Patterns

### Server-only module header and lazy initialization
**Source:** `src/lib/server/db.ts` lines 1-2 and `src/lib/server/auth.ts` lines 270-285
**Apply to:** every file under `src/lib/server/search/`
Header comment `// src/lib/server/... // Server-only module`, module-level `let x: T | undefined` singletons created on first call, never at import time (hooks.server.ts lines 10-17 also comment "Runs once at server start (not at import)"). For optional warm-up of the model, `src/hooks.server.ts` `init` (lines 11-17) is the established place: wrap in try/catch, `console.warn('... failed to start:', err instanceof Error ? err.message : err)`, never fatal.

### Error handling / logging
**Source:** `src/routes/api/try-out/+server.ts` lines 73-76; `scripts/ingest.ts` line 106
**Apply to:** API route, ingest embedding step, embedder
```typescript
} catch (err) {
  console.error('Try out processing failed', err)
  return json({ message: 'The try out session could not be processed.' }, { status: 500 })
}
```
API error bodies use `{ message }` for handler errors; hooks 401 uses `{ error }`. Degradation (model unavailable) is `console.warn` once, not an error.

### Input validation
**Source:** `src/routes/api/try-out/+server.ts` lines 10-42 (zod `safeParse`, 400 on failure)
**Apply to:** `/api/search`. For a single query param manual trim/slice (RESEARCH snippet) is sufficient; zod (`z.string().trim().max(200)`) is the in-repo alternative if the planner wants consistency.

### JSON array columns
**Source:** `src/routes/catalog/+page.server.ts` lines 36-44
**Apply to:** `documents.ts`, `index.ts`, any row-to-agent mapping. `tags`, `toolNames` are JSON text; `inputSchema` is stripped from the card payload with `const { inputSchema, ...agentRow } = row`. If `/api/search` or `load` returns full agents, reuse this mapping (consider extracting a shared helper; `agents/[slug]/+page.server.ts` lines 36-45 duplicates it).

### Test conventions
**Source:** `src/lib/server/tryitout/clientLimit.test.ts`, `src/lib/components/FilterBar.test.ts`, `scripts/ingest.test.ts`
**Apply to:** all new tests. Colocated, `vitest` explicit imports (no globals), jsdom pragma for components, injected fakes over module mocks where possible, `vi.mock('$lib/server/db.js', ...)` only for route loaders.

### Containerfile / build
**Source:** `Containerfile` lines 26-28 (`COPY package.json package-lock.json ./` then `RUN npm ci`), line 47 (`npm prune --omit=dev --ignore-scripts`), lines 61-63 (runtime `COPY --from=builder`)
**Apply to:** dependency add. Set `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` on the `npm ci` line (`RUN ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci`), `ENV HF_CACHE_DIR=/app/db/models` in both stages so the existing `COPY --from=builder /app/db ./db` (line 62) carries the model cache with no extra COPY if the cache dir lives under `db/`. Note `--ignore-scripts` on prune does not re-run install scripts, which is fine. `package.json` scripts `build`/`dev` already chain `npm run ingest` (lines 11, 13) so embeddings are generated in the build with no new script required. Add `@huggingface/transformers` to `dependencies` (not dev).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| BM25 scoring math in `bm25.ts` | utility | transform | No ranking/IR code in repo; use RESEARCH Code Examples (k1=1.2, b=0.75, non-negative IDF, title x3 / tags x2 token weighting, last-token prefix match) |
| RRF + cosine floor in `hybrid.ts` | utility | transform | No fusion code in repo; use RESEARCH Pattern 2 (k=60, weights 1.0/0.5 for <=2 tokens, floor ~0.25 to tune) |
| Debounce + AbortController fetch in catalog page | component | event-driven | No existing debounce/fetch-cancel code under `src/lib/components` or routes; use RESEARCH SearchBar snippet. (If the planner picks the `goto`-driven path the abort logic is unnecessary; SvelteKit discards stale loads.) |

## Metadata

**Analog search scope:** `src/lib/server/**`, `src/lib/components/**`, `src/routes/**`, `scripts/**`, `drizzle/`, `Containerfile`, `package.json`, `vitest.config.ts`, `src/hooks.server.ts`
**Files scanned:** ~120 tracked files listed; ~20 read in detail
**Tracked-source check:** all analog paths appear in `git ls-files` output (none are gitignored mirrors)
**Pattern extraction date:** 2026-10-12
