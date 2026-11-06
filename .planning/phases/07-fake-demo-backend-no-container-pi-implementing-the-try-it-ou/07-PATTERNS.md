# Phase 7: No-Container Demo Backend for Try It Out - Pattern Map

**Mapped:** 2026-08-19
**Files analyzed:** 10
**Analogs found:** 8 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/tryItOut.ts` (modify — replace bodies below mock banner) | service (client API) | request-response | itself (existing mock section, same file) | exact — in-place replacement |
| `src/lib/server/tryItOutJobs.ts` | store/model | CRUD (in-memory) | `src/lib/server/db.ts` (server-only module convention) + `scripts/ingest.ts`'s `flattenRecord`-style plain-object shaping | role-match |
| `src/lib/server/tryItOutRunner.ts` | service (event-driven async worker) | event-driven / streaming (staged) | `src/lib/tryItOut.ts`'s existing `runMockScript` (same staged-event concept, timer-driven → replace with real-phase-driven) | role-match |
| `src/lib/server/tryItOutPrompts.ts` | service (data loader) | file-I/O + CRUD (DB read) | `src/lib/server/db.ts` (DB access pattern) + `scripts/ingest.ts` (file read via `node:fs/promises`) | role-match |
| `src/routes/api/tryitout/jobs/+server.ts` | route (POST) | request-response | none in-repo (`src/routes/api/*` doesn't exist yet) — closest structural analog is `src/routes/agents/[slug]/+page.server.ts`'s `db.select()`-then-shape pattern | no analog — new pattern, use RESEARCH.md Code Examples |
| `src/routes/api/tryitout/jobs/[id]/+server.ts` | route (GET) | request-response | same as above | no analog |
| `src/routes/api/tryitout/jobs/[id]/artifact/+server.ts` | route (GET, file download) | file-I/O | none — client-side download exists (`triggerTextDownload` in `tryItOut.ts`) but no server-side file-download route anywhere | no analog |
| `data/agents/demo-rfi-triage.yaml` | config (AgentSpec YAML) | file-I/O (static) | `data/agents/rfi-triage-assistant.yaml`, `data/agents/hvac-load-calculator.yaml` | exact |
| `data/tryitout-prompts/demo-rfi-triage/skill.md` | config (prompt file) | file-I/O (static) | none — no `.md` prompt file exists in repo yet | no analog |
| one-off DB `UPDATE` (mode flip for `demo-rfi-triage` → `runnable`, `hvac-load-calculator` → `none`) | migration/utility | CRUD | `scripts/ingest.test.ts` lines ~104-132 (raw `db.prepare('UPDATE agents SET try_it_out_mode = ...')`) | exact — same D-13 mechanism from Phase 5 |
| test files (`tryItOutJobs.test.ts`, `tryItOutRunner.test.ts`, `tryItOutPrompts.test.ts`, jobs route test, `tryItOut.test.ts`) | test | — | `src/lib/tryItOut.test.ts` (existing, same file being extended) + `scripts/ingest.test.ts` (DB-backed test setup pattern) | exact |

## Pattern Assignments

### `src/lib/tryItOut.ts` (modify in place)

**Analog:** the file itself — lines 1-49 are FROZEN (do not touch), everything from the `MOCK IMPLEMENTATION` banner (~line 51) down gets deleted and replaced.

**Frozen header to preserve verbatim** (lines 1-25):
```typescript
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface JobEvent {
  ts: string // "10:46:48"
  type: 'tool_start' | 'tool_end' | 'info'
  tool?: string
  summary: string
}

export interface JobUpdate {
  status: JobStatus
  events: JobEvent[]
  error: string | null
}

export interface SubmitResult {
  jobId: string
  status: JobStatus
}
```

**Timestamp helper to reuse verbatim in the new server code** (`nowTs`, lines ~81-85 of the current mock):
```typescript
function nowTs(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
```
This exact "HH:MM:SS via Date parts, no ICU/locale dependency" implementation must be duplicated (not imported — client file cannot import server-only code) into `src/lib/server/tryItOutJobs.ts`. RESEARCH.md's Pattern 2 code example already does this correctly — copy that, not a `toLocaleTimeString` variant.

**Replace bodies with real `fetch()` per RESEARCH.md Architecture Patterns → Pattern 4** (`submitJob`/`subscribeProgress`/`downloadArtifact`). Note the existing mock's `downloadArtifact` triggers a browser download via `Blob`/`URL.createObjectURL`/anchor-click/`URL.revokeObjectURL` — reuse that exact DOM-download sequence (it must not leak object URLs — see `// threat T3` comment in the current mock) when writing the real version that fetches a `Blob` from `/api/tryitout/jobs/:id/artifact` instead of building the Blob from a string.

---

### `src/lib/server/tryItOutJobs.ts` (new)

**Analog:** `src/lib/server/db.ts` for the "server-only module" convention; `scripts/ingest.ts`'s `flattenRecord()` for the plain-object-shaping style.

**Server-only module pattern** (`src/lib/server/db.ts`, full file, 11 lines):
```typescript
// src/lib/server/db.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { agents } from '../../../drizzle/schema.js'

const DB_PATH = process.env.CATALOG_DB_PATH ?? './db/catalog.db'

const sqlite = new Database(DB_PATH)
sqlite.pragma('journal_mode = WAL')

export const db = drizzle(sqlite)
export { agents }
```
Key convention to copy: env-var-with-fallback for any filesystem path (`process.env.CATALOG_DB_PATH ?? './db/catalog.db'`) — apply the same idiom for `.tryitout-work` if an override is ever needed, though CONTEXT.md leaves the exact layout to discretion (plain `join(process.cwd(), '.tryitout-work')` is fine per RESEARCH.md).

Use RESEARCH.md's Architecture Patterns → Pattern 2 code block verbatim as the implementation skeleton (module-level `Map`, `createJob`/`getJob`/`pushEvent`/`setStatus`, `workDir`/`inputDir`/`outputDir`/`outputFilePath` helpers) — it is already fully consistent with this codebase's conventions (bare `process.env.X` access matching `db.ts`, no extra abstraction).

---

### `src/lib/server/tryItOutRunner.ts` (new)

**Analog (concept, not code):** the mock's `runMockScript` in `src/lib/tryItOut.ts` — same idea of "push staged events, then flip terminal status" — but timer-driven there vs. real-phase-driven here (D-12). Do not reuse `tool_start`/`tool_end` typing (mock-only); this file must emit `type: 'info'` only (D-11).

**Error-message discipline (from CONTEXT.md/RESEARCH.md, contrasted against the mock's fabricated string):**
The mock file has:
```typescript
const MOCK_ERROR = 'pi exited non-zero: required input file missing'
```
This exact style (fake `pi`-process error) must NOT be copied. The new runner's `catch` block must surface the real `Error.message` from the OpenAI SDK or filesystem call, per RESEARCH.md's Pattern 3 code example:
```typescript
} catch (err) {
  pushEvent(jobId, 'agent failed')
  setStatus(jobId, 'failed', err instanceof Error ? err.message : String(err))
}
```

Use RESEARCH.md's Architecture Patterns → Pattern 3 full code block as the implementation skeleton (staged `pushEvent` calls at "reading input…" / "calling model…" / "writing output…", `client.responses.create()` call, terminal `succeeded`/`failed`).

---

### `src/lib/server/tryItOutPrompts.ts` (new)

**Analog:** `src/lib/server/db.ts` (DB access — reuse `db`/`agents` import to look up `systemPrompt` by slug) + `scripts/ingest.ts` (file read via `node:fs/promises`).

**DB read pattern to follow** (query `agents` by slug — mirror the shape already used in `src/routes/agents/[slug]/+page.server.ts`'s `db.select()...where(eq(agents.slug, ...))`, not shown here but referenced in CONTEXT.md's Integration Points — reuse the same `db`/`agents` import from `src/lib/server/db.ts` rather than opening a second sqlite connection).

**File-read pattern** (`scripts/ingest.ts` line 1 + line ~57):
```typescript
import { readdir, readFile, mkdir } from 'node:fs/promises'
...
const content = await readFile(join(dataDir, file), 'utf-8')
```
Apply the same `readFile(path, 'utf-8')` idiom for `skill.md`. Per RESEARCH.md Open Questions §2, `skill.md` lives at `data/tryitout-prompts/<agentId>/skill.md` — deliberately outside `data/agents/` so `scripts/ingest.ts`'s `readdir(dataDir)` YAML/JSON extension filter never picks it up.

---

### `src/routes/api/tryitout/jobs/+server.ts`, `[id]/+server.ts`, `[id]/artifact/+server.ts` (new)

**No in-repo analog** — this is the first `src/routes/api/*` directory in the codebase. Use RESEARCH.md's Architecture Patterns → Pattern 1 code blocks verbatim as the implementation (already verified live against SvelteKit's own routing docs):
- POST handler: `request.formData()`, fire-and-forget `runJob(...).catch(...)`, immediate `json({ jobId, status })` return — must NOT await the LLM call (see RESEARCH.md Anti-Patterns).
- GET `:id` handler: `getJob(params.id)`, 404 via `error(404, ...)` on miss.
- GET `:id/artifact` handler: `readFile` + `new Response(buf, { headers: { 'Content-Type', 'Content-Disposition': attachment } })`, 409 if job not yet `succeeded`.

**Response shaping convention to match** `src/routes/agents/[slug]/+page.server.ts`'s existing pattern of shaping a DB row into a plain serializable object before returning it to the client (same discipline applies to `{ status, events, error }`).

---

### `data/agents/demo-rfi-triage.yaml` (new)

**Analog:** `data/agents/rfi-triage-assistant.yaml` (full file read above) and `data/agents/hvac-load-calculator.yaml` (structurally identical shape, not re-read — same fields).

**Structure to copy** (`data/agents/rfi-triage-assistant.yaml`, full 24 lines):
```yaml
component_type: Agent
id: "aic-mep-rfi-triage-001"
name: "RFI Triage Assistant"
description: "..."
metadata:
  category: "project-management"
  github_url: "..."
  maturity: "production"
  tags:
    - "rfi"
system_prompt: "You are an MEP RFI triage assistant. ..."
llm_config:
  name: "claude-sonnet-4-6"
  default_generation_parameters:
    max_tokens: 2048
    temperature: 0.4
    top_p: 0.95
tools:
  - name: "search_prior_rfis"
    description: "..."
human_in_the_loop: true
```
For `demo-rfi-triage.yaml`: per D-05, omit any `try_it_out_*` field entirely (none of the existing YAMLs have one either — this is already the established convention, nothing to change). Per D-01, `name`/`description` must explicitly read as demo-only (e.g. "Demo: RFI Triage (single-LLM-call demo, not a production WP5 agent)"). `llm_config` block should still be present for schema-shape consistency (D-07 says the backend ignores it) — copy the same nested shape as the analog, just with placeholder/irrelevant values since the runner never reads it.

---

### `data/tryitout-prompts/demo-rfi-triage/skill.md` (new)

**No analog** — first prompt/skill markdown file in the repo. Content must encode verbatim intent from CONTEXT.md D-02/Specific Ideas: read the uploaded RFI text, classify by urgency and discipline (structural/MEP/architectural), write classification + recommended routing + one-line rationale. No code pattern to copy; this is plain prose content, not a template engine.

---

### One-off DB `UPDATE` (flip `demo-rfi-triage` → `runnable`, `hvac-load-calculator` → `none`)

**Analog:** `scripts/ingest.test.ts` (raw `db.prepare` UPDATE, lines ~104-132) — this is the exact D-13 mechanism Phase 5 established and this phase must reuse, not reinvent:
```typescript
db.prepare(`UPDATE agents SET try_it_out_mode = 'external', try_it_out_url = 'https://example.com/try/x' WHERE slug = 'customer-support-triager'`).run()
```
Apply the same `db.prepare('UPDATE agents SET try_it_out_mode = ? WHERE slug = ?').run(...)` idiom (via `better-sqlite3`, same `DB_PATH` resolution as `src/lib/server/db.ts`) as either a one-off script or an addition to a seed/setup script — whichever the planner decides — but the SQL mechanism itself must mirror this exact tested pattern, never touching `scripts/ingest.ts`'s `onConflictDoUpdate` set-block (which must keep excluding `try_it_out_*`, per the comment at `scripts/ingest.ts` lines ~83-89).

---

### Test files (new)

**Analog:** `src/lib/tryItOut.test.ts` (existing, full structure read above) for client-API test conventions; `scripts/ingest.test.ts` for DB-backed test setup conventions.

**Client-API test conventions to copy** (`src/lib/tryItOut.test.ts`):
- `// @vitest-environment jsdom` banner at top when DOM APIs (`URL.createObjectURL`, anchor `.click()`) are involved.
- `vi.useFakeTimers()` / `vi.useRealTimers()` in `beforeEach`/`afterEach` — replace with `vi.stubGlobal('fetch', ...)` mocking for the new real-`fetch()`-backed `tryItOut.ts` tests, since there are no more timers to fake.
- `describe` blocks per exported function (`submitJob`, `subscribeProgress`, `downloadArtifact`), with a dedicated `describe('unknown job handling', ...)` block for the 404/error path — mirror this structure for the new fetch-mocked version.

**DB-backed test setup convention** (`scripts/ingest.test.ts`, referenced): uses an in-memory or temp-file `better-sqlite3` instance with the same schema DDL inline, then runs assertions via raw `db.prepare(...).get()`/`.run()`. Reuse this same temp-DB-per-test-file setup style for `tryItOutJobs.test.ts` and `tryItOutPrompts.test.ts` (mocking `openai` client per RESEARCH.md's Validation Architecture table for `tryItOutRunner.test.ts`).

## Shared Patterns

### Server-only module boundary
**Source:** `src/lib/server/db.ts` (comment line: `// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.`)
**Apply to:** `tryItOutJobs.ts`, `tryItOutRunner.ts`, `tryItOutPrompts.ts` — all three must live under `src/lib/server/` (not `src/lib/`) so SvelteKit's bundler enforcement guarantees `OPENAI_API_KEY` (D-09/SC-09) never reaches client bundles. Carry the same explanatory comment banner into each new file.

### Env-var-with-fallback for filesystem/config paths
**Source:** `src/lib/server/db.ts` line 6 (`const DB_PATH = process.env.CATALOG_DB_PATH ?? './db/catalog.db'`) and `scripts/ingest.ts` lines 12-13 (`DATA_DIR`/`DB_PATH` same idiom)
**Apply to:** `.tryitout-work` root directory constant in `tryItOutJobs.ts` — same `process.env.X ?? 'default'` idiom, consistent with the rest of the repo, even though no override is strictly required for the demo.

### `try_it_out_*` DB-column exclusion discipline (D-05/D-13, locked in Phase 5)
**Source:** `scripts/ingest.ts` lines 30-36 (flattenRecord hardcodes `tryItOutMode: 'none'` on insert) and lines 83-89 (`onConflictDoUpdate` set-block comment: "deliberately OMITTED... try_it_out is not sourced from AgentSpec YAML")
**Apply to:** Any code touching ingest or the new YAML — `demo-rfi-triage.yaml` must have no `try_it_out` field, and no new code may add `tryItOutMode`/`tryItOutUrl`/`tryItOutTaskTemplate` into `scripts/ingest.ts`'s update `set` block. The mode flip happens exclusively via the one-off `UPDATE` pattern above.

### Timestamp formatting (`HH:MM:SS`, no locale API)
**Source:** `src/lib/tryItOut.ts` `nowTs()` (mock section, ~lines 81-85)
**Apply to:** `tryItOutJobs.ts`'s `pushEvent` (server-side event timestamps) — duplicate this exact implementation (Date-parts + zero-pad), do not use `toLocaleTimeString` or a date library.

### Fire-and-forget async execution from a request handler
**Source:** RESEARCH.md Anti-Patterns section + Pattern 1 POST handler code (`runJob(job.jobId).catch(() => { /* runJob owns its own failed-status write */ })`)
**Apply to:** `src/routes/api/tryitout/jobs/+server.ts` only — this is the one genuinely new pattern in the codebase (no prior async-fire-and-forget route exists), flagged here because it is easy to get wrong (accidentally `await`-ing it defeats `queued`/`running` staging per SC-04/D-11).

## No Analog Found

Files with no close match in the codebase (planner should rely on RESEARCH.md's Architecture Patterns / Code Examples instead):

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/routes/api/tryitout/jobs/+server.ts` | route | request-response | No `src/routes/api/*` directory exists anywhere yet — first SvelteKit `+server.ts` in this repo |
| `src/routes/api/tryitout/jobs/[id]/+server.ts` | route | request-response | Same as above |
| `src/routes/api/tryitout/jobs/[id]/artifact/+server.ts` | route | file-I/O | Same as above; also no server-side file-download response exists yet (only client-side Blob download in the mock) |
| `data/tryitout-prompts/demo-rfi-triage/skill.md` | config (prompt content) | file-I/O | No `.md` prompt/skill file exists anywhere in the repo — this phase establishes the convention from scratch |

## Metadata

**Analog search scope:** `src/lib/`, `src/lib/server/`, `src/lib/components/`, `src/routes/`, `scripts/`, `data/agents/`, `drizzle/`
**Files scanned:** `src/lib/tryItOut.ts`, `src/lib/tryItOut.test.ts`, `src/lib/server/db.ts`, `scripts/ingest.ts`, `scripts/ingest.test.ts`, `drizzle/schema.ts`, `data/agents/rfi-triage-assistant.yaml`, `data/agents/hvac-load-calculator.yaml` (referenced, not re-read), `src/routes/agents/try-it-out.test.ts`, `package.json`
**Pattern extraction date:** 2026-08-19
