# Phase 7: No-Container Demo Backend for Try It Out - Research

**Researched:** 2026-08-19
**Domain:** SvelteKit server routes + OpenAI Node SDK (Responses API) single-call "cheat" backend
**Confidence:** HIGH (SDK/API/SvelteKit mechanics, verified live against official docs and npm registry) / MEDIUM (exact current model-ID choice — the API changes fast and third-party summaries disagreed with each other; verify at implementation time per Open Questions)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Do NOT demo-enable `hvac-load-calculator` or any existing catalog agent whose real tools (BIM extraction, ASHRAE calculations, etc.) can't actually run in this phase. Instead, add a brand-new demo-only agent: `data/agents/demo-rfi-triage.yaml`. Its name and description must clearly mark it as demo-only so it's never mistaken for a real WP5 catalog agent later.
- **D-02:** The demo agent's job is pure read → reason → write (honest to what a single LLM call can actually do): read an uploaded RFI (Request for Information) text file, classify it by urgency and by discipline (e.g. structural / MEP / architectural), and write a short triage result file containing the classification, recommended routing, and a one-line rationale. `skill.md` for this agent encodes exactly this task.
- **D-03:** `hvac-load-calculator`'s `try_it_out_mode` reverts from `runnable` back to `none` (it was left `runnable` in Phase 6 only so that phase's mock demo had something to point at).
- **D-04:** One demo agent is enough for this phase — no second demo agent needed.
- **D-05:** `try_it_out_mode`/`try_it_out_url`/`try_it_out_task_template` are DB columns that ingest deliberately never overwrites (Phase 5 D-05/D-06/D-07) — they are NOT sourced from the YAML. So `demo-rfi-triage.yaml`'s frontmatter has no `try_it_out` field; setting its row to `mode: 'runnable'` (and reverting `hvac-load-calculator`'s row to `mode: 'none'`) happens via the same one-off DB `UPDATE` mechanism Phase 5 used (D-13 pattern) — not via ingest or YAML.
- **D-06:** Add `openai` (the official OpenAI SDK) as a new dependency (not currently in `package.json`). — *Changed 2026-08-19: originally `@anthropic-ai/sdk`; user redirected to OpenAI mid-session, before any implementation started.*
- **D-07:** Use a single fixed model + fixed low temperature for ALL runnable demo agents — do NOT read `llm_config` per-agent from the YAML. Reading per-agent config is generality this demo doesn't need and adds a failure mode (a YAML naming a model the deployed key can't reach). — **Reversibility:** costly — **rationale:** switching to per-agent model config later means touching every call site that currently assumes one fixed model/temperature constant.
- **D-08:** Resolve the exact OpenAI API model ID during research/implementation (verify against the actual API — confirm what the deployed key/account actually accepts before hardcoding it, e.g. via the OpenAI models list endpoint or current API docs).
- **D-09:** The API key is supplied via a server-side-only env var, never sent to or read by client code. Use the SDK's standard `OPENAI_API_KEY` env var name (the `openai` client reads this by default) unless research surfaces a reason to deviate.
- **D-10:** Persist `jobId` via a URL query param (`?job=<jobId>`), NOT a cookie. It survives a refresh the same as a cookie would and makes a running/finished job's URL shareable.
- **D-11:** Do NOT leave `events: []` empty until the terminal state. Instead emit synthetic staged `JobEvent`s as real execution actually reaches each stage: "reading input…" → "calling model…" → "writing output…" → terminal succeeded/failed. These stages must be labeled/typed as processing-stage `info` events, NOT as `tool_start`/`tool_end` — we are not pretending there's a real tool-call stream.
- **D-12:** Stage lines are emitted as each phase of REAL execution actually begins (not on a fixed fake timer) — e.g. "calling model…" is emitted right when the OpenAI API request is issued, not at a hardcoded offset.

### Claude's Discretion

- Exact fixed temperature value (a low value, e.g. 0.1–0.3, consistent with D-07's intent) — **research finding: this is not always possible; see Open Questions §1 — the current flagship model family rejects non-default temperature entirely.**
- Behavior when no file is uploaded (submitJob's `file` param is optional per the frozen contract): reasonable fallback is to treat the `task` text itself as the RFI content to classify, and skip/adjust the "reading input…" stage line accordingly.
- `failed`-status error strings should describe the REAL failure (LLM API error, missing/unreadable input, etc.) — do NOT fabricate a fake `pi exited non-zero`-style message like Phase 6's mock did.
- Uploaded file handling: assume plain text (UTF-8) input for the demo; no requirement to support binary/PDF/etc. Reasonable size cap left to implementation.
- Exact SvelteKit route file layout for `POST /api/tryitout/jobs`, `GET /api/tryitout/jobs/:id`, `GET /api/tryitout/jobs/:id/artifact` (standard `+server.ts` conventions — no existing `src/routes/api/*` precedent in this codebase to match against).
- In-memory job-store data shape (keyed by `jobId`) and working-directory layout under `.tryitout-work/<jobId>/{input,output}/` — isolation is by UUID prefix only, file-collision risk knowingly accepted for the demo.

### Deferred Ideas (OUT OF SCOPE)

- Real in-process `pi`/GAISE runtime execution (RPC mode, `agent_settled` completion, real tool-call streaming) — tracked as its own future phase per the `try-it-out-runtime-architecture` memory. This phase's LLM-only "cheat" backend must not grow into that.
- Re-enabling `hvac-load-calculator` (or any other existing catalog agent) as `runnable` — explicitly deferred; would require real tool execution this phase doesn't provide.
- A second demo agent — explicitly not needed for this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

No formal REQ IDs assigned. Scope is defined by ROADMAP.md's 9 numbered success criteria for Phase 7 (SC-01..SC-09 below, numbered per ROADMAP order).

| ID | Description | Research Support |
|----|-------------|-------------------|
| SC-01 | `POST /jobs` creates a `jobId` that acts as a fake container ID; no container or `pi` is started | Architecture Patterns → Route Layout; Code Examples → POST handler. `crypto.randomUUID()` (Node built-in, no dependency) generates `jobId`. |
| SC-02 | The uploaded file is written to a `jobId`-prefixed server folder | Architecture Patterns → Working Directory Layout; Code Examples → file write via `node:fs/promises`. |
| SC-03 | For the given `agentId` the backend loads BOTH the hardcoded base prompt AND the agent's `skill.md` from the package, and passes both plus the uploaded file to the model | Architecture Patterns → Prompt/Skill File Loading; Open Questions §2 (exact file location is a discretion call, concrete recommendation given). |
| SC-04 | Backend calls the language model, writes an output file, and status goes `queued → running → succeeded` (or `failed` with an error) | Code Examples → OpenAI Responses API call; job-store status transition pattern. |
| SC-05 | Progress is staged status only (no live tool-event feed); download brightens on success | D-11/D-12 mapped to Code Examples → stage-event emission at each real execution phase. |
| SC-06 | GET status and GET artifact work; download returns the real generated result | Code Examples → GET `/jobs/:id` and GET `/jobs/:id/artifact` handlers (file-download `Response` headers). |
| SC-07 | `src/lib/tryItOut.ts` calls the routes via `fetch`; UI components (incl. the Phase 6 panel) unchanged | Code Examples → real `fetch()`-backed `submitJob`/`subscribeProgress`/`downloadArtifact` bodies, same frozen signatures. |
| SC-08 | `jobId` is persisted on the client and survives a refresh in the same session; the finished result and download remain available | D-10; recommend `?job=` URL param read on page mount + `goto(..., {replaceState:true})`, matching the existing Phase 2 pattern already used in this codebase. |
| SC-09 | The LLM provider/key are server-side only, never exposed to the client | D-09; SDK reads `process.env.OPENAI_API_KEY` server-side only, inside `+server.ts`/`src/lib/server/*` modules which SvelteKit never bundles to the client. |
</phase_requirements>

## Summary

This phase swaps Phase 6's client-side mock timer script for a real, single-process SvelteKit backend that makes exactly one OpenAI API call per job. The mechanics are all standard and low-risk: SvelteKit `+server.ts` route handlers, `request.formData()` for the multipart upload, a module-level `Map` as the job store, and `node:fs/promises` for reading/writing the `.tryitout-work/<jobId>/{input,output}/` files. None of this needs a new architectural pattern beyond what SvelteKit and Node already provide out of the box — there is nothing here to hand-roll a library for.

The one substantive risk uncovered by research is **D-07's "fixed low temperature" requirement colliding with the current OpenAI model generation**: OpenAI's GPT-5-family reasoning models (including the current flagship `gpt-5.6-sol`/`gpt-5.6-terra`/`gpt-5.6-luna` line) reject any `temperature` value other than the default (1.0) with a 400 error — this is confirmed by OpenAI's own community forum threads and multiple independent bug reports from unrelated projects (LiteLLM, LibreChat, Graphiti), not just training-data recall. Models that still accept an explicit low `temperature` are `gpt-4.1` (and its `-mini`/`-nano` variants) and `gpt-5-chat-latest`. Because sources disagree on whether `gpt-4.1` is still live in the API as of today (one live-fetched OpenAI pricing page still lists it; several third-party 2026 migration-guide blogs claim it returns 404 since mid-February 2026), **the model ID must be verified against the actual deployed key at implementation time** via `client.models.list()` before hardcoding it — see Open Questions §1 for the concrete verification snippet and fallback plan.

**Primary recommendation:** Use `gpt-4.1-mini` as the fixed model with `temperature: 0.2` if `client.models.list()` confirms it is available to the deployed key at implementation time; otherwise fall back to `gpt-5.6-luna` (or whichever current cheapest GPT-5-family model the key exposes) and **omit the `temperature` parameter entirely** rather than sending a value the API will reject — treat "fixed low temperature" as best-effort, not a hard guarantee, for that fallback path, and note the deviation in a code comment.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| `openai` | `^7.5.0` (verified via `npm view openai version` — 2026-08-17) | Official OpenAI Node SDK; `client.responses.create()` for the single LLM call | Official first-party SDK; reads `OPENAI_API_KEY` from env by default; requires Node 20 LTS+ (project runs Node v22.23.1 — confirmed via `node --version`) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:fs/promises` (built-in) | Node 22 | Write uploaded file to `.tryitout-work/<jobId>/input/`, read it back for the prompt, write model output to `.tryitout-work/<jobId>/output/` | Always — no need for a file-handling library for plain-text reads/writes |
| `node:crypto` (`randomUUID()`, built-in) | Node 22 | Generate `jobId` | Always — do not add a `uuid` npm package, Node has this natively |
| `zod` | `^4.3.6` (already a project dependency) | Validate the incoming `agentId`/`task` form fields before touching the filesystem or calling the model | Optional but recommended — project already uses Zod for the ingest pipeline's schema validation; reuse the same discipline for the new route boundary |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `client.responses.create()` | `client.chat.completions.create()` | Chat Completions remains fully supported ("legacy alternative" per the SDK's own README) and returns `choices[0].message.content` instead of the simpler `response.output_text`. No reason to prefer it here — Responses API is what OpenAI's own docs now front-and-center for new integrations, and it comes with the very slightly simpler return shape (`response.output_text` vs `message.content[0].text`). Use Chat Completions only if `responses.create()` turns out not to support whatever fallback model gets chosen. |
| Module-level `Map` job store | A real cache/queue library (Redis, BullMQ, etc.) | Explicit out of scope — this is a single-process demo with no worker pool; a library here would be pure over-engineering for a "cheating" show-and-tell backend. |
| `gpt-4.1-mini` fixed model | `gpt-5.6-luna` (cheapest current flagship-family model) | `gpt-5.6-luna` is the cheaper, more "current" choice, but as of this research it rejects any custom `temperature`, conflicting with D-07's literal wording. Use it only as the verified-availability fallback, with `temperature` omitted. |

**Installation:**
```bash
npm install openai
```

**Version verification:** confirmed live — `npm view openai version` → `7.5.0`, `time.modified: 2026-08-17`. `npm view @anthropic-ai/sdk version` was also checked (`0.119.0`) before the provider switch but is no longer relevant since D-06 now specifies `openai`, not `@anthropic-ai/sdk`.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── routes/
│   └── api/
│       └── tryitout/
│           └── jobs/
│               ├── +server.ts              # POST /api/tryitout/jobs
│               └── [id]/
│                   ├── +server.ts          # GET /api/tryitout/jobs/:id
│                   └── artifact/
│                       └── +server.ts      # GET /api/tryitout/jobs/:id/artifact
├── lib/
│   ├── tryItOut.ts                          # frozen client API — real fetch() bodies replace mock bodies
│   └── server/
│       ├── db.ts                            # existing — unchanged
│       ├── tryItOutJobs.ts                  # NEW — module-level Map job store + status transitions
│       ├── tryItOutRunner.ts                # NEW — read input → call OpenAI → write output, emits stage events into the job store
│       └── tryItOutPrompts.ts               # NEW — loads base prompt + skill.md for a given agentId
data/
├── agents/
│   └── demo-rfi-triage.yaml                 # NEW — AgentSpec YAML, no try_it_out field (D-05)
└── tryitout-prompts/
    └── demo-rfi-triage/
        └── skill.md                         # NEW — the "shipped with the app" skill file (see Open Questions §2)
.tryitout-work/                              # NEW — gitignored working directory, created at runtime
└── <jobId>/
    ├── input/
    └── output/
```

### Pattern 1: `+server.ts` route handlers

**What:** SvelteKit server-only route modules. A file named `+server.ts` inside `src/routes/**` exports HTTP-verb-named functions (`GET`, `POST`, etc.) of type `RequestHandler`. The route path is derived from the directory path; `[id]` is a dynamic segment available as `params.id`.
**When to use:** Any endpoint that is not a page — exactly this phase's three job endpoints.
**Example:**
```typescript
// src/routes/api/tryitout/jobs/+server.ts
// Source: SvelteKit routing docs (svelte.dev/docs/kit/routing) — verified live 2026-08-19
import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { createJob } from '$lib/server/tryItOutJobs'
import { runJob } from '$lib/server/tryItOutRunner'

export const POST: RequestHandler = async ({ request }) => {
  const form = await request.formData()
  const agentId = form.get('agentId')
  const task = form.get('task')
  const file = form.get('file') // File | null (form.get returns null if absent)

  if (typeof agentId !== 'string' || typeof task !== 'string') {
    error(400, 'agentId and task are required')
  }

  const job = createJob(agentId, task, file instanceof File ? file : null)

  // Fire-and-forget: do NOT await — POST must return `queued` immediately (SC-01/SC-04).
  runJob(job.jobId).catch(() => {
    /* runJob is responsible for writing its own `failed` status + error into the job store */
  })

  return json({ jobId: job.jobId, status: job.status })
}
```

```typescript
// src/routes/api/tryitout/jobs/[id]/+server.ts
import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getJob } from '$lib/server/tryItOutJobs'

export const GET: RequestHandler = ({ params }) => {
  const job = getJob(params.id)
  if (!job) error(404, `unknown job: ${params.id}`)
  return json({ status: job.status, events: job.events, error: job.error })
}
```

```typescript
// src/routes/api/tryitout/jobs/[id]/artifact/+server.ts
import { error } from '@sveltejs/kit'
import { readFile } from 'node:fs/promises'
import type { RequestHandler } from './$types'
import { getJob, outputFilePath } from '$lib/server/tryItOutJobs'

export const GET: RequestHandler = async ({ params }) => {
  const job = getJob(params.id)
  if (!job) error(404, `unknown job: ${params.id}`)
  if (job.status !== 'succeeded') error(409, `job ${params.id} is not succeeded (status: ${job.status})`)

  const buf = await readFile(outputFilePath(params.id))
  return new Response(buf, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="aic-job-${params.id}.txt"`,
    },
  })
}
```

### Pattern 2: In-memory job store (module-level singleton)

**What:** A single `Map<string, JobRecord>` declared once at module scope in `src/lib/server/tryItOutJobs.ts`. Because ESM modules are cached by resolved path, every route file that imports this module gets the *same* Map instance — no extra singleton machinery needed.
**When to use:** Exactly this phase's scope — single Node process, no clustering, no persistence-across-restarts requirement.
**Example:**
```typescript
// src/lib/server/tryItOutJobs.ts
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { JobStatus, JobEvent } from '$lib/tryItOut'

interface JobRecord {
  jobId: string
  agentId: string
  task: string
  fileName: string | null
  status: JobStatus
  events: JobEvent[]
  error: string | null
}

const jobs = new Map<string, JobRecord>() // module-level singleton — same instance for every importer

const WORK_DIR = join(process.cwd(), '.tryitout-work')

export function workDir(jobId: string) { return join(WORK_DIR, jobId) }
export function inputDir(jobId: string) { return join(workDir(jobId), 'input') }
export function outputDir(jobId: string) { return join(workDir(jobId), 'output') }
export function outputFilePath(jobId: string) { return join(outputDir(jobId), 'result.txt') }

export function createJob(agentId: string, task: string, file: File | null): JobRecord {
  const jobId = randomUUID()
  const rec: JobRecord = { jobId, agentId, task, fileName: file?.name ?? null, status: 'queued', events: [], error: null }
  jobs.set(jobId, rec)
  return rec
}

export function getJob(jobId: string) { return jobs.get(jobId) }

export function pushEvent(jobId: string, summary: string) {
  const job = jobs.get(jobId)
  if (!job) return
  job.events.push({ ts: nowTs(), type: 'info', summary })
}

export function setStatus(jobId: string, status: JobStatus, error: string | null = null) {
  const job = jobs.get(jobId)
  if (!job) return
  job.status = status
  job.error = error
}

function nowTs(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
```

### Pattern 3: Real staged-progress runner (D-11/D-12)

**What:** The async function invoked (not awaited) from the POST handler. It emits an `info` event at the moment each real phase of work begins, then flips status.
**Example:**
```typescript
// src/lib/server/tryItOutRunner.ts
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import OpenAI from 'openai'
import { getJob, pushEvent, setStatus, inputDir, outputDir, outputFilePath } from './tryItOutJobs'
import { loadPromptFor } from './tryItOutPrompts'

const client = new OpenAI() // reads process.env.OPENAI_API_KEY by default (D-09)
const MODEL = 'gpt-4.1-mini' // verify against deployed key before shipping — see Open Questions §1
const TEMPERATURE = 0.2

export async function runJob(jobId: string): Promise<void> {
  const job = getJob(jobId)
  if (!job) return
  setStatus(jobId, 'running')

  try {
    pushEvent(jobId, 'reading input…')
    const inputText = job.fileName
      ? await readFile(`${inputDir(jobId)}/${job.fileName}`, 'utf-8')
      : job.task // D-13 discretion: no file uploaded -> task text itself is the RFI content

    const { basePrompt, skill } = await loadPromptFor(job.agentId)

    pushEvent(jobId, 'calling model…')
    const response = await client.responses.create({
      model: MODEL,
      temperature: TEMPERATURE,
      input: `${basePrompt}\n\n${skill}\n\n---\nInput to triage:\n${inputText}`,
    })

    pushEvent(jobId, 'writing output…')
    await mkdir(outputDir(jobId), { recursive: true })
    await writeFile(outputFilePath(jobId), response.output_text, 'utf-8')

    pushEvent(jobId, 'agent settled (clean exit)')
    setStatus(jobId, 'succeeded')
  } catch (err) {
    pushEvent(jobId, 'agent failed')
    setStatus(jobId, 'failed', err instanceof Error ? err.message : String(err))
  }
}
```

### Pattern 4: Real `fetch()`-backed client (`src/lib/tryItOut.ts`)

**What:** Replace only the bodies below the mock banner. `subscribeProgress` becomes a poll loop (contract doc explicitly marks poll as the provisional transport).
**Example:**
```typescript
export async function submitJob(agentId: string, task: string, file?: File | null): Promise<SubmitResult> {
  const form = new FormData()
  form.set('agentId', agentId)
  form.set('task', task)
  if (file) form.set('file', file)
  const res = await fetch('/api/tryitout/jobs', { method: 'POST', body: form })
  if (!res.ok) throw new Error(`submitJob failed: ${res.status}`)
  return res.json()
}

export function subscribeProgress(jobId: string, onUpdate: (u: JobUpdate) => void): () => void {
  let cancelled = false
  const POLL_MS = 1000

  async function poll() {
    if (cancelled) return
    const res = await fetch(`/api/tryitout/jobs/${jobId}`)
    if (!res.ok) {
      onUpdate({ status: 'failed', events: [], error: `poll failed: ${res.status}` })
      return
    }
    const update: JobUpdate = await res.json()
    onUpdate(update)
    if (!cancelled && update.status !== 'succeeded' && update.status !== 'failed') {
      setTimeout(poll, POLL_MS)
    }
  }
  poll()

  return () => { cancelled = true }
}

export async function downloadArtifact(jobId: string): Promise<void> {
  const res = await fetch(`/api/tryitout/jobs/${jobId}/artifact`)
  if (!res.ok) throw new Error(`downloadArtifact failed: ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `aic-job-${jobId}.txt`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
```

### Anti-Patterns to Avoid

- **Awaiting the LLM call inside the POST handler:** would block the HTTP response for the full model round-trip and defeat the whole point of `queued`/`running` staging. Fire-and-forget the runner; return `queued` immediately.
- **Passing `temperature` unconditionally to every model:** GPT-5-family models 400 on any non-default value — see Open Questions §1. Gate this per model, don't hardcode it as always-present.
- **Re-declaring the job-store `Map` in more than one file:** breaks the singleton assumption if it's accidentally duplicated instead of imported from one module — all three route files must import from the same `tryItOutJobs.ts`.
- **Faking `tool_start`/`tool_end` events:** D-11 explicitly requires `info`-typed stage events only; reusing Phase 6 mock's `tool_start`/`tool_end` typing here would misrepresent what's actually happening (a single non-tool-using LLM call).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID generation for `jobId` | A custom random-string generator | `crypto.randomUUID()` (Node built-in) | Cryptographically strong, zero dependencies, already available in Node 22 |
| Reading a multipart file upload | Manual multipart boundary parsing | `await request.formData()` (Web standard API, supported natively by SvelteKit's `Request`) | SvelteKit's `RequestEvent.request` is a standard Web `Request`; `formData()` handles multipart parsing internally |
| File-download response headers | Guessing `Content-Disposition` syntax | `new Response(buf, { headers: { 'Content-Disposition': 'attachment; filename="..."' } })` | Standard header, one correct form; no library needed |
| OpenAI error handling | Ad-hoc status-code checks on a raw `fetch` to the OpenAI HTTP API | The `openai` SDK's typed error classes (`OpenAI.APIError` etc.), thrown from `client.responses.create()` | SDK already does retry/timeout/error-typing; hand-rolling this means re-solving problems OpenAI's own SDK team already solved |

**Key insight:** Everything in this phase's happy path is either a Web-standard API SvelteKit exposes for free (`formData()`, `Response`), a Node built-in (`crypto`, `fs/promises`), or the vendor SDK doing exactly what it's for. There is no part of this phase where a hand-rolled solution would be simpler or more correct than the existing primitive.

## Common Pitfalls

### Pitfall 1: GPT-5-family models reject non-default `temperature`
**What goes wrong:** Sending `temperature: 0.2` (or any value other than 1) to `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, or the current `gpt-5.6-*` flagship family returns a 400 `Unsupported parameter: 'temperature' is not supported with this model`.
**Why it happens:** These are reasoning models; OpenAI's own community-forum guidance states the internal multi-pass reasoning process doesn't compose with forced sampling-parameter control, so the API rejects anything but the default.
**How to avoid:** Verify the chosen model against `client.models.list()` before wiring the temperature constant; prefer `gpt-4.1`/`gpt-4.1-mini` (confirmed to still accept custom `temperature`) or `gpt-5-chat-latest` if that alias exists on the account, or omit `temperature` entirely if only reasoning-family models are available on the deployed key.
**Warning signs:** A 400 error on the very first live LLM call with a message mentioning `temperature`; this will surface immediately in local testing, not as a silent failure.

### Pitfall 2: Dev-server HMR can reset the in-memory job store mid-session
**What goes wrong:** `npm run dev` runs Vite; editing any file imported by `tryItOutJobs.ts` (including the file itself) during active development can cause Vite to re-evaluate that module, clearing the `Map` and losing all in-flight/finished job state.
**Why it happens:** Standard Vite/SvelteKit dev-mode module invalidation on file save — this is expected dev-server behavior, not a bug in the job-store code.
**How to avoid:** Acceptable and expected for a demo; do not try to "fix" this with persistence — it doesn't happen in the built/`adapter-node` production server (`node build`), which loads modules once for the life of the process. Just don't be surprised by it while iterating.
**Warning signs:** A previously-running job suddenly returns 404 from `GET /jobs/:id` right after a code edit + dev-server reload, with no other error.

### Pitfall 3: `formData.get('file')` returns an empty `File` object, not `null`, when the browser sends the field with no file selected
**What goes wrong:** Some browsers/`<input type="file">` submissions send a zero-byte `File` with an empty name (`""`) rather than omitting the field, even when nothing was picked.
**Why it happens:** Standard-but-surprising `multipart/form-data` behavior for empty file inputs.
**How to avoid:** Treat a `File` with `.size === 0` and `.name === ''` the same as "no file uploaded" (fall back to task-text-as-input per Claude's Discretion), not as a valid empty file to write to disk.
**Warning signs:** An empty `input/` file gets written and the model receives blank content instead of falling back to the task text.

### Pitfall 4: `process.cwd()`-relative paths differ between `npm run dev` and the built `adapter-node` server
**What goes wrong:** `.tryitout-work/` created relative to `process.cwd()` will land wherever the process is *launched from*, which may not be the project root if the built server (`node build/index.js`) is started from a different working directory in deployment.
**Why it happens:** `process.cwd()` reflects the shell's directory at process start, not the location of the built script.
**How to avoid:** Document that the deploy/run command must `cd` into the project root (or wherever `.tryitout-work/` is intended to live) before starting `node build`; this matches the existing pattern already in this repo (`db/catalog.db` is also resolved via a bare relative path in `src/lib/server/db.ts`), so no new convention is being introduced — just be aware of it.
**Warning signs:** Working locally in dev but the deployed demo throws `ENOENT` on `.tryitout-work/...` paths.

## Code Examples

See Architecture Patterns above for the full, verified-shape POST/GET/artifact handlers, job store, runner, and client `fetch()` bodies — all code there is authoritative for this phase and grounded in the live-fetched SvelteKit routing docs and the `openai` SDK's own README example.

### OpenAI Responses API — minimal verified call shape
```typescript
// Source: raw.githubusercontent.com/openai/openai-node/master/README.md — fetched live 2026-08-19
import OpenAI from 'openai'

const client = new OpenAI() // process.env.OPENAI_API_KEY read by default

const response = await client.responses.create({
  model: 'gpt-4.1-mini', // verify against deployed key — see Open Questions §1
  input: 'Are semicolons optional in JavaScript?',
})

console.log(response.output_text) // simplest way to get plain text out
```

### Verifying model availability against the deployed key
```typescript
// Source: developers.openai.com/api/docs/api-reference/models/list — fetched live 2026-08-19
const models = await client.models.list()
const ids = models.data.map(m => m.id)
console.log(ids.includes('gpt-4.1-mini')) // confirm before hardcoding MODEL constant
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `client.chat.completions.create()` as the default/primary call | `client.responses.create()` fronted as the primary API in current OpenAI docs | Ongoing since Responses API's 2025 introduction, still true as of this research (Aug 2026) | Simpler return shape (`response.output_text` vs `choices[0].message.content`); Chat Completions remains supported as a fallback, not removed |
| Freely settable `temperature` on all chat models | GPT-5-family reasoning models (`gpt-5*`, current `gpt-5.6-*` flagship line) accept only the default `temperature: 1` | Since the GPT-5 reasoning-model generation launched (2025) and confirmed still true for `gpt-5.6-*` as of Aug 2026 | Any code assuming "every OpenAI model accepts `temperature`" will 400 on the current flagship model family — must gate per model or pick a non-reasoning model |

**Deprecated/outdated:**
- Whether `gpt-4.1`/`gpt-4o` are still callable via the API is **actively disputed between sources** as of this research — see Open Questions §1. Do not treat either "still available" or "already retired" as settled without a live check.

## Open Questions

1. **Which exact model ID should be hardcoded, given the temperature conflict?**
   - What we know: OpenAI's live-fetched official pricing/model docs (fetched 2026-08-19) list `gpt-4.1` as still actively priced and not flagged deprecated. Independently, multiple 2026-dated third-party migration-guide blog posts (not official Anthropic/OpenAI sources) claim `gpt-4.1`, `gpt-4o`, and `o4-mini` started returning 404/deprecation errors from the API in mid-February 2026. These two source sets directly contradict each other, and the blog-post claims could not be corroborated on any *official* OpenAI page during this research pass.
   - What's unclear: Whether the deployed API key for this project can actually reach `gpt-4.1`/`gpt-4.1-mini` right now.
   - Recommendation: **Before wiring the `MODEL` constant, the implementing task must call `client.models.list()` (or `curl https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"`) against the actual deployed key and grep for `gpt-4.1-mini` (or `gpt-4.1`) in the returned `data[].id` list.** If present: use it with `temperature: 0.2`. If absent: use the cheapest currently-listed non-`-pro` model in the `gpt-5.6-*`/`gpt-5-*` family that the key exposes, and **omit the `temperature` parameter** rather than sending a value that will 400. Either way, hardcode a single dateless model ID string (per OpenAI's convention, these are pinned snapshots even without an explicit date suffix) as one constant in `tryItOutRunner.ts`, matching D-07's "one fixed model" requirement.

2. **Where should `skill.md` and the "hardcoded base prompt" physically live?**
   - What we know: `data/agents/*.yaml` already has a `system_prompt` field that gets ingested into the `agents.systemPrompt` DB column (see `drizzle/schema.ts`, `scripts/ingest.ts`). No `skill.md`-equivalent field exists anywhere in the AgentSpec YAML shape or the DB schema. CONTEXT.md left the exact file layout to implementation discretion.
   - What's unclear: Whether "the hardcoded base prompt" (SC-03) should be a fresh file, or a reuse of the already-ingested `agents.systemPrompt` DB value for `demo-rfi-triage`.
   - Recommendation: **Reuse `agents.systemPrompt` (already populated from the YAML at ingest time) as "the hardcoded base prompt"** — it already ships with the app via the existing ingest pipeline, satisfying the "shipped with the app" framing without inventing a second prompt-storage mechanism. Add `skill.md` as a new file at `data/tryitout-prompts/<agentId>/skill.md` (a new top-level directory, deliberately *not* nested under `data/agents/` so it can never collide with `scripts/ingest.ts`'s `readdir(dataDir)` `.yaml`/`.yml`/`.json` extension filter). `src/lib/server/tryItOutPrompts.ts` reads `agents.systemPrompt` from the DB by `agentId` (slug) plus `readFile` on the sibling `skill.md` path.

3. **Is a request body / uploaded-file size cap needed, and where is it best enforced?**
   - What we know: CONTEXT.md leaves this to implementation ("reasonable size cap left to implementation"); SvelteKit has a `Content-Length`-based default body-size limit but it's aimed at general abuse-prevention, not this specific flow.
   - What's unclear: No hard requirement from the phase's success criteria — this is a demo, not a hardened service.
   - Recommendation: enforce a simple explicit cap (e.g. reject files/text over ~200 KB with a 413-style `error()` before writing to disk or calling the model) purely so a mis-clicked large-file upload doesn't blow up the LLM context or produce a giant `.tryitout-work/` file; not required for the success criteria to pass, but cheap insurance worth a single `if` check in the POST handler.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.0` |
| Config file | `vitest.config.ts` (project root) — `environment: 'node'` by default, `jsdom` only for `src/lib/components/**` |
| Quick run command | `npx vitest run <path-to-file>` |
| Full suite command | `npm test` (== `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| SC-01 | POST creates a `jobId`, no container/`pi` started | unit | `npx vitest run src/lib/server/tryItOutJobs.test.ts` | ❌ Wave 0 |
| SC-02 | Uploaded file written to `jobId`-prefixed folder | unit (real filesystem, tmp-scoped) | `npx vitest run src/lib/server/tryItOutRunner.test.ts` | ❌ Wave 0 |
| SC-03 | Base prompt + skill.md both loaded and passed to model | unit (mock `openai` client) | `npx vitest run src/lib/server/tryItOutPrompts.test.ts` | ❌ Wave 0 |
| SC-04 | Status transitions `queued → running → succeeded`/`failed` | unit (mock `openai` client, real job store) | `npx vitest run src/lib/server/tryItOutRunner.test.ts` | ❌ Wave 0 |
| SC-05 | Staged `info` events only, no `tool_start`/`tool_end` | unit | `npx vitest run src/lib/server/tryItOutRunner.test.ts` | ❌ Wave 0 |
| SC-06 | GET status / GET artifact endpoints work; download returns real result | integration (call exported `GET`/`POST` handlers directly with a constructed `RequestEvent`-shaped object) | `npx vitest run src/routes/api/tryitout/jobs/jobs.test.ts` | ❌ Wave 0 |
| SC-07 | `tryItOut.ts` calls real routes via `fetch`; UI unchanged | unit (mock global `fetch`) + existing `try-it-out.test.ts` regression | `npx vitest run src/lib/tryItOut.test.ts src/routes/agents/try-it-out.test.ts` | Partial — `try-it-out.test.ts` exists (Phase 6), `tryItOut.test.ts` unit test on the client functions ❌ Wave 0 |
| SC-08 | `jobId` persists across refresh via `?job=` | manual / smoke (browser refresh check) — component-level automated coverage would require e2e tooling not present in this repo | manual-only, justified: no Playwright/e2e harness in this project; `TryItOutPanel.svelte` reading `page.url.searchParams` is trivial enough that a unit test of the read/write helper suffices for regression safety | `npx vitest run src/lib/components/TryItOutPanel.test.ts` (if such a helper is extracted) | ❌ Wave 0, optional |
| SC-09 | API key never sent to/read by client code | static check | `grep -rn "OPENAI_API_KEY" src/routes/**/*.svelte src/lib/components` (must return nothing) | manual/CI grep, not a vitest test | N/A — verification step, not a test file |

### Sampling Rate
- **Per task commit:** run the single new/changed test file (`npx vitest run <file>`).
- **Per wave merge:** `npm test` (full suite).
- **Phase gate:** Full suite green before `/gsd:verify-work`, plus a real manual run of the demo end-to-end (upload a sample RFI `.txt`, confirm staged progress lines appear in order, confirm the download button works) since this phase's core value (an actual LLM call producing a real triage result) can only be honestly confirmed by one live run against the real API — mocking the OpenAI client in unit tests verifies the *code path*, not that the deployed key/model actually produces a sane triage output.

### Wave 0 Gaps
- [ ] `src/lib/server/tryItOutJobs.test.ts` — job store create/get/pushEvent/setStatus behavior
- [ ] `src/lib/server/tryItOutRunner.test.ts` — staged-event ordering, success/fail status transitions, mocked `openai` client
- [ ] `src/lib/server/tryItOutPrompts.test.ts` — base-prompt (DB) + skill.md (file) both loaded and concatenated correctly for `demo-rfi-triage`
- [ ] `src/routes/api/tryitout/jobs/jobs.test.ts` — POST/GET/artifact handler behavior called directly (no full HTTP server needed; SvelteKit route modules export plain functions)
- [ ] `src/lib/tryItOut.test.ts` — new file; the mock-era code had no dedicated unit test for `tryItOut.ts` itself (coverage lived in `src/routes/agents/try-it-out.test.ts` at the component level) — add one for the real `fetch()`-based bodies with a mocked global `fetch`
- [ ] `.gitignore` — add `.tryitout-work/` (new runtime working directory, must never be committed)
- [ ] `data/agents/demo-rfi-triage.yaml` and `data/tryitout-prompts/demo-rfi-triage/skill.md` — new fixture-like content the tests above depend on

## Sources

### Primary (HIGH confidence)
- `raw.githubusercontent.com/openai/openai-node/master/README.md` — fetched live 2026-08-19: `client.responses.create()` usage, `OPENAI_API_KEY` default env behavior, Node 20+ requirement, `chat.completions.create()` legacy-alternative note
- `developers.openai.com/api/docs/models` — fetched live 2026-08-19: current model ID list (`gpt-5.6-sol`/`terra`/`luna`, legacy `gpt-4.1` still listed)
- `developers.openai.com/api/docs/pricing` — fetched live 2026-08-19: `gpt-4.1` still present in active pricing tables, not flagged deprecated
- `developers.openai.com/api/docs/api-reference/models/list` — fetched live 2026-08-19: `client.models.list()` shape, `id`/`shutdown_date` fields — the concrete D-08 verification mechanism
- `svelte.dev` SvelteKit routing docs (`docs/kit/routing`) — fetched live 2026-08-19: `+server.ts` GET/POST conventions, `request.formData()`, `params.id`, file-download `Response` pattern
- `svelte.dev` `$env/dynamic/private` / `$env/static/private` docs — fetched live 2026-08-19 (note: not used in the final recommendation — SDK reads `process.env` directly, matching this repo's existing `src/lib/server/db.ts` pattern of bare `process.env.X`)
- `npm view openai version` / `npm view @anthropic-ai/sdk version` — run live 2026-08-19 against the real npm registry
- Direct repo reads: `docs/job-api-contract.md`, `src/lib/tryItOut.ts`, `package.json`, `drizzle/schema.ts`, `scripts/ingest.ts`, `data/agents/hvac-load-calculator.yaml`, `data/agents/rfi-triage-assistant.yaml`, `src/routes/agents/[slug]/+page.server.ts`, `svelte.config.js`, `.gitignore`, `vitest.config.ts`, `src/routes/agents/try-it-out.test.ts`

### Secondary (MEDIUM confidence)
- OpenAI Developer Community forum thread "Temperature in GPT-5 models" (`community.openai.com/t/temperature-in-gpt-5-models/1337133`) — corroborated by independent GitHub bug reports from unrelated projects (LiteLLM #13781, LibreChat #10737, Graphiti #878) all describing the identical 400 error — cross-source agreement raises this from single-source to medium confidence, but it is still community/third-party reporting, not an official Anthropic-style model-card statement

### Tertiary (LOW confidence)
- Various 2026-dated SEO/migration-guide blog posts (`remio.ai`, `kissapi.ai`, `tensorops.ai`, `gend.co`, `tech-insider.org`) claiming `gpt-4.1`/`gpt-4o`/`o4-mini` were retired from the API in February 2026 — flagged explicitly in Open Questions §1 as contradicting the live-fetched official OpenAI pricing page; do not treat as settled without a live `models.list()` check against the deployed key

## Metadata

**Confidence breakdown:**
- Standard stack (SvelteKit routing, `openai` SDK basic call shape, in-memory job store pattern): HIGH — all verified against live-fetched official docs/README and the real npm registry, not training-data recall alone
- Architecture (route layout, file layout, prompt-loading convention): MEDIUM-HIGH — mechanics are HIGH confidence; the exact `skill.md` file location is this researcher's recommendation for an area CONTEXT.md explicitly left to discretion, not a locked decision
- Pitfalls (temperature rejection, dev-server HMR reset, empty-file-input, cwd-relative paths): HIGH for the temperature finding (cross-corroborated across four independent bug trackers plus OpenAI's own forum); HIGH for the SvelteKit/Node mechanics (standard, well-documented platform behavior)
- Model ID choice specifically: MEDIUM — genuinely contested between sources as of this research; explicitly flagged as requiring a live verification step before implementation, not stated as settled fact

**Research date:** 2026-08-19
**Valid until:** ~14 days for the model-ID/temperature specifics (this is the fastest-moving part of the OpenAI ecosystem and was already found to be actively contested between sources during this research pass); ~30 days for the SvelteKit/Node mechanics (stable platform APIs)
