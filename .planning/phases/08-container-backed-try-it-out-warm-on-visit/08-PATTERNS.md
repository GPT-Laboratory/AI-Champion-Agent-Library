# Phase 8: Container-backed Try It Out (warm on visit) - Pattern Map

**Mapped:** 2026-10-08
**Files analyzed:** 33 (14 new server modules and tests, 10 modified source/test files, 9 deploy/docs/scripts/data files)
**Analogs found:** 27 / 33 (all analog paths verified git-tracked via `git ls-files`)

Repo facts the planner must know first:
- No `CLAUDE.md`, no `.claude/skills/` or `.agents/skills/` exist. Conventions come from the code below.
- Existing Try It Out server code is FLAT in `src/lib/server/` with a `tryItOut*` prefix (`tryItOutJobs.ts`, `tryItOutRunner.ts`, `tryItOutPrompts.ts`, `tryItOutModel.ts`) with co-located `*.test.ts`. RESEARCH proposes a `src/lib/server/tryitout/` subdirectory. Either works. The subdirectory is cleaner for 9+ new files, and RESEARCH's validation commands assume it. The planner should pick ONE and use it in every plan. The tests below use relative imports (`./tryItOutJobs`) and `$lib/server/...` aliases; new files should use the `$lib/server/...` alias when crossing directories.
- Server-only code lives under `src/lib/server/` and starts with the two-line header `// src/lib/server/<file>.ts` and `// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.`
- Private env is read with `import { env } from '$env/dynamic/private'`, and `process.env.X` is also used as a fallback or for module-load constants.
- No `.js` suffix is needed on relative imports in `src/lib/server/` (`./tryItOutJobs`), but `+page.server.ts` for agents uses `'$lib/server/db.js'`. Follow the neighbouring file.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/server/tryitout/config.ts` (new) | config | transform | `src/lib/server/tryItOutJobs.ts` (WORK_ROOT env), `src/lib/server/auth-config.ts`, `src/lib/server/auth.ts` (constants) | role-match |
| `src/lib/server/tryitout/runtime.ts` (new: `ContainerRuntime` interface, error classes) | service (interface) | request-response | `src/lib/server/auth.ts` (`AuthError` class + typed codes) | partial |
| `src/lib/server/tryitout/runtimeDockerode.ts` (new) | service | request-response + streaming | none for dockerode; `src/lib/server/tryItOutRunner.ts` (lazy memoized client) | partial |
| `src/lib/server/tryitout/runtimeFake.ts` (new) | test util | request-response | `src/lib/testing/fakeJobApi.ts` | role-match |
| `src/lib/server/tryitout/leaseManager.ts` (new) | service (singleton state machine) | event-driven (timers, CAS) | `src/lib/server/tryItOutJobs.ts` (module-level Map singleton) | role-match |
| `src/lib/server/tryitout/piEvents.ts` (new) | utility | transform / streaming | `src/lib/server/tryItOutPrompts.ts` (pure helpers `composePrompt`) | partial |
| `src/lib/server/tryitout/piRunner.ts` (new: `runJobInContainer`) | service | streaming + file-I/O | `src/lib/server/tryItOutRunner.ts` `runJob` | exact |
| `src/lib/server/tryitout/llmProxy.ts` (new) | service | streaming (SSE passthrough) | `src/lib/server/auth.ts` (token hash, `timingSafeEqual`) | partial |
| `src/lib/server/tryitout/artifact.ts` (new: `zipOutputFiles`) | utility | file-I/O + transform | `src/lib/server/tryItOutJobs.ts` path helpers + `tryItOutRunner.ts` mkdir/writeFile | role-match |
| `src/lib/server/tryitout/session.ts` (new: `sessionKey`) | utility | request-response | `src/hooks.server.ts` + `authCookieOptions` in `src/lib/server/auth.ts` | role-match |
| `src/routes/api/llm/v1/chat/completions/+server.ts` (new) | route (controller) | streaming | `src/routes/api/try-out/+server.ts` (JSON POST, zod) | role-match |
| `src/lib/server/tryItOutRunner.ts` (modify: dispatcher + `runDirectLlmJob` fallback + zip) | service | request-response | itself | exact |
| `src/lib/server/tryItOutJobs.ts` (modify: `sessionKey`, tool event types, artifact path) | service (store) | CRUD in-memory | itself | exact |
| `src/lib/server/tryItOutPrompts.ts` (modify: read `SKILL.md`, strip frontmatter) | service | file-I/O | itself | exact |
| `src/routes/api/tryitout/jobs/+server.ts` (modify: sessionKey) | route | request-response | itself | exact |
| `src/routes/api/tryitout/jobs/[id]/artifact/+server.ts` (modify: zip) | route | file-I/O | itself | exact |
| `src/routes/agents/[slug]/+page.server.ts` (modify: warm trigger) | route (load) | event-driven (fire-and-forget) | itself + `src/routes/login/+page.server.ts` (cookies) | exact |
| `src/hooks.server.ts` (modify: public `/api/llm/` prefix, eager manager init) | middleware | request-response | itself | exact |
| `src/app.d.ts` (maybe modify) | config | n/a | itself | exact |
| `src/lib/tryItOut.ts` (modify body only: `.zip` filename) | utility (client) | request-response | itself | exact |
| `data/tryitout-prompts/demo-rfi-triage/SKILL.md` (rename + rewrite from `skill.md`) | data/skill | n/a | `data/tryitout-prompts/demo-rfi-triage/skill.md` | exact |
| `Containerfile.pi-runner` (new) | config (image) | n/a | `Containerfile` | role-match |
| `Containerfile` (modify, maybe) | config | n/a | itself | exact |
| `podman-compose.yml` (modify: socket, networks, env) | config | n/a | itself | exact |
| `.env.example`, `README.md` (modify: new env knobs, pi-runner build) | docs/config | n/a | themselves | exact |
| `scripts/smoke-pi-runner.ts` (new, live manual) | script | request-response | `scripts/probe-openai-model.ts` | exact |
| `package.json` (modify: add dockerode, tar-stream, fflate, @types/dockerode) | config | n/a | itself | exact |
| Tests: `leaseManager.test.ts`, `piEvents.test.ts`, `piRunner.test.ts`, `artifact.test.ts`, `runtimeDockerode.test.ts`, `llmProxy.test.ts` / route test, `src/hooks.server.test.ts`, `src/routes/agents/[slug]` warm test | test | n/a | `src/lib/server/tryItOutRunner.test.ts`, `tryItOutJobs.test.ts`, `src/routes/agents/detail.test.ts` | exact / role-match |
| Tests to update: `tryItOutRunner.test.ts`, `jobs.test.ts`, `tryItOutPrompts.test.ts`, `src/lib/tryItOut.test.ts`, `tryItOutJobs.test.ts` | test | n/a | themselves | exact |

## Pattern Assignments

### `src/lib/server/tryItOutRunner.ts` (modify: dispatcher + fallback) and `piRunner.ts` (new)

**Analog:** `src/lib/server/tryItOutRunner.ts` (the current `runJob`). `piRunner.ts` is the same shape (get job, `setStatus running`, staged `pushEvent`, try/catch with real error string).

**Imports pattern** (lines 9-21):
```typescript
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import OpenAI from 'openai'
import { env } from '$env/dynamic/private'
import {
  getJob,
  pushEvent,
  setStatus,
  inputFilePath,
  outputDir,
  outputFilePath,
} from './tryItOutJobs'
import { loadPromptFor, composePrompt } from './tryItOutPrompts'
import { MODEL, modelParams } from './tryItOutModel'
```

**Lazy client, never at import time (SC-09)** (lines 23-34): keep for the fallback and copy the principle for the proxy's `OPENAI_API_KEY` and dockerode.
```typescript
let client: OpenAI | undefined
function getClient(): OpenAI {
  if (!client) {
    const apiKey = env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY
    client = new OpenAI({ apiKey })
  }
  return client
}
```

**Core pattern** (lines 36-83): status flips to `running` synchronously before the first `await`; unknown job returns silently; catch converts to `pushEvent('agent failed')` + `setStatus('failed', real message)`.
```typescript
export async function runJob(jobId: string): Promise<void> {
  const job = getJob(jobId)
  if (!job) return // unknown jobId — nothing to run, nothing to mutate

  setStatus(jobId, 'running')
  try {
    ...
    pushEvent(jobId, 'agent settled (clean exit)')
    setStatus(jobId, 'succeeded')
  } catch (err) {
    pushEvent(jobId, 'agent failed')
    setStatus(jobId, 'failed', err instanceof Error ? err.message : String(err))
  }
}
```

**Change plan (from D-14, RESEARCH "Architecture Patterns"):**
- Rename current body to `runDirectLlmJob(jobId)` (exported for the dispatcher). New exported `runJob(jobId)` keeps the same signature, because `src/routes/api/tryitout/jobs/+server.ts` line 65 and the tests call `runJob(job.jobId)`.
- `runJob` dispatches: try `runJobInContainer`; on `EngineUnavailable | ContainerStartFailed` and `PI_FALLBACK_ENABLED`, then `console.warn(...)`, `pushEvent(jobId, 'container unavailable, falling back to direct model call')`, and call `runDirectLlmJob`. On `Busy`, `setStatus(jobId, 'failed', 'all Try It Out slots are busy, try again shortly')` and NEVER fall back.
- `runDirectLlmJob` must write `output/result.txt` (via the existing `outputDir`/`outputFilePath` writes, lines 71-73) and then call the shared `zipOutputFiles` so the artifact is a zip (D-13/D-14).
- Keep the existing `pushEvent` summaries ("reading input…", "calling model…", "writing output…", "agent settled (clean exit)"). `tryItOutRunner.test.ts` asserts their order.

**Error handling:** real error strings only (comment at lines 78-79). For the container path add the completion rule from RESEARCH R-04 (`exit 0 AND settled AND stopReason not error/aborted`).

---

### `src/lib/server/tryItOutJobs.ts` (modify)

**Analog:** itself. Extend; do not restructure.

**Env-at-module-load constant** (line 21) is the style for every new path knob:
```typescript
const WORK_ROOT = process.env.TRYITOUT_WORK_DIR ?? join(process.cwd(), '.tryitout-work')
```

**Path helper + traversal guard** (lines 38-79). Add `artifactZipPath(jobId)` the same way (`assertValidJobId` first, then `join(workDir(jobId), 'artifact.zip')`):
```typescript
export function outputFilePath(jobId: string): string {
  assertValidJobId(jobId)
  return join(outputDir(jobId), 'result.txt')
}
```

**Store record + factory** (lines 23-32, 81-95): add `sessionKey: string` to `JobRecord` and a param to `createJob(agentId, task, file, sessionKey)`. Do NOT return it from the GET route (route builds its response literally).

**`pushEvent`** (lines 101-107) only emits `type: 'info'` (comment cites Phase 7 D-11, superseded by Phase 8 D-12). Extend with an optional type/tool, for example `pushEvent(jobId, summary, type = 'info', tool?)`, keeping the 2-argument call form valid for existing callers and tests:
```typescript
export function pushEvent(jobId: string, summary: string): void {
  const job = jobs.get(jobId)
  if (!job) return // silent no-op on unknown jobId
  job.events.push({ ts: nowTs(), type: 'info', summary })
}
```
`JobEvent` (from `src/lib/tryItOut.ts` lines 9-14) already has `type: 'tool_start' | 'tool_end' | 'info'` and `tool?`, so no client type change is needed.

**Test reset hook** (lines 116-120): `__resetJobs()` pattern. Copy it for the lease manager and proxy token registry (`__resetLeases()`, `__resetProxy()`).

---

### `src/lib/server/tryitout/leaseManager.ts` (new, singleton state machine)

**Analog:** `src/lib/server/tryItOutJobs.ts` (module-level `Map` singleton, `__reset` test hook, header comment explaining accepted tradeoffs). Nothing in the repo uses `setInterval`/`globalThis` guards, so for the HMR guard and reaper use RESEARCH Pattern 1 and Pattern 7 verbatim.

**Singleton + reset pattern to copy** (tryItOutJobs.ts lines 34-36, 116-120):
```typescript
const jobs = new Map<string, JobRecord>()
...
export function __resetJobs(): void { jobs.clear() }
```
Copy the shape: `const leases = new Map<string, Lease>()`, plus a `globalThis.__aicTryItOut` guard for dev HMR (new; from RESEARCH Pitfall 7). Every state transition must be synchronous with no `await` between check and set (RESEARCH `tryClaim` and `tryEvict` sketches, lines 231-241).

**Config reads:** take cap, idle TTL, min idle, and so on from `config.ts`, not inline.

---

### `src/lib/server/tryitout/config.ts` (new)

**Analog (style):** `src/lib/server/tryItOutPrompts.ts` and `tryItOutJobs.ts` env-with-default constants; `src/lib/server/auth-config.ts` for the parse-then-read split (pure parser testable without `$env`).

**Pure-parser + `$env` wrapper pattern** (auth-config.ts lines 1-9):
```typescript
import { env } from '$env/dynamic/private'

export function parseAuthenticationEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== 'false'
}
export function isAuthenticationEnabled(): boolean {
  return parseAuthenticationEnabled(env.AUTH_ENABLED)
}
```
Copy: export pure `parseRunnerConfig(source: Record<string, string | undefined>)` (zod with defaults, since `zod` ^4 is a dependency and `AgentIdSchema` in `tryItOutPrompts.ts` lines 23-27 shows zod usage) and a thin `getRunnerConfig()` that reads `env` at call time (not import time). Test the parser like `auth-config.test.ts` (lines 1-20). Env names per RESEARCH (`PI_RUNNER_*`, `PI_FALLBACK_ENABLED`, `PI_LLM_PROXY_URL`, `PI_JOB_TOKEN_BUDGET`...). Boolean env: copy the `AUTH_ENABLED` "only literal false disables" semantics for `PI_FALLBACK_ENABLED`/`PI_RUNNER_ENABLED`.

---

### `src/lib/server/tryitout/session.ts` (new)

**Analog:** `src/hooks.server.ts` (sets `event.locals.user`, calls `isAuthenticationEnabled()`), `authCookieOptions` in `src/lib/server/auth.ts` (lines 289-299).

**Cookie options to reuse for the anon session cookie** (auth.ts lines 289-299):
```typescript
export function authCookieOptions(url: URL, expiresAt?: number) {
  const configuredSecure = env.AUTH_COOKIE_SECURE
  const secure = configuredSecure === 'true' || (configuredSecure !== 'false' && url.protocol === 'https:')
  return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure,
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}) }
}
```
Reuse `authCookieOptions(url)` for `aic_tryout_sid` (it already sets path, httpOnly, lax, secure). Cookie get/set usage example: `src/routes/login/+page.server.ts` line 59 `cookies.set(AUTH_COOKIE_NAME, session.token, authCookieOptions(url, session.expiresAt))`.

**Identity source:** `event.locals.user?.email` (typed in `src/app.d.ts`: `user: { email: string } | null`). `locals.user` is `null` when auth is off (hooks.server.ts line 9), which triggers the cookie branch. Token generation: `randomBytes(32).toString('base64url')` (auth.ts line 225). The helper takes `{ locals, cookies, url }` and is used from both `+page.server.ts` (warm) and `POST /api/tryitout/jobs` (claim).

---

### `src/lib/server/tryitout/llmProxy.ts` (new) and `src/routes/api/llm/v1/chat/completions/+server.ts` (new)

**Analog (token handling):** `src/lib/server/auth.ts`. **Analog (route shape):** `src/routes/api/try-out/+server.ts`.

**Token/hash/timing-safe pattern** (auth.ts line 2, 60, 213, 225):
```typescript
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
...
return createHash('sha256').update(token).digest('hex')                // line 60
if (suppliedHash.length !== row.code_hash.length || !timingSafeEqual(suppliedHash, row.code_hash)) { ... }  // line 213
const token = randomBytes(32).toString('base64url')                     // line 225
```
Copy: tokens minted as `randomBytes(32).toString('base64url')`; registry keyed by SHA-256 digest; lookup by digest then `timingSafeEqual` on equal-length buffers.

**Route shape** (`src/routes/api/try-out/+server.ts` lines 1-8, 31-42): `RequestHandler` from `./$types`, `json(...)` responses, `try { await request.json() } catch { return json({ message }, { status: 400 }) }`, zod `safeParse`, `console.error('... failed', err)` and a generic client message on 500. For the proxy, error bodies should use OpenAI-style `{ error: { message } }` (RESEARCH Pattern 4), and success returns `new Response(upstream.body, { status, headers })` (streaming), not `json()`.

**Key read at request time, never import time** (tryItOutRunner.ts line 30): `env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY`. `MODEL` forced from `src/lib/server/tryItOutModel.ts` line 18 (`export const MODEL = 'gpt-4.1-mini'`) and `TEMPERATURE` via `modelParams()` if temperature is clamped.

**Never log** Authorization headers or bodies (RESEARCH Pattern 4).

---

### `src/hooks.server.ts` (modify)

**Analog:** itself. Current public-route logic (lines 5, 23-27):
```typescript
const PUBLIC_ROUTES = new Set(['/login', '/health'])
...
const isPublic = PUBLIC_ROUTES.has(event.url.pathname) || event.route.id === null
if (!event.locals.user && !isPublic) {
  if (event.url.pathname.startsWith('/api/')) {
    return json({ error: 'Authentication required' }, { status: 401 })
  }
```
Change: `const isPublic = PUBLIC_ROUTES.has(pathname) || pathname.startsWith('/api/llm/') || event.route.id === null` (RESEARCH Pitfall 5; `PUBLIC_ROUTES` is an exact-match `Set`, so the prefix check must be separate). Note the auth-off early return (lines 8-14) already lets everything through. Also add the eager manager-init import here if desired (RESEARCH Pattern 7). There is NO existing `src/hooks.server.test.ts`; create one that calls the exported `handle` with a fake `event` (`{ url, request, cookies: { get, set }, locals: {}, route: { id } }`) and a `resolve` spy. Mock `$lib/server/auth` and `$lib/server/auth-config` the way `detail.test.ts` mocks modules with `vi.mock`.

---

### `src/routes/agents/[slug]/+page.server.ts` (modify: warm trigger)

**Analog:** itself (30 lines, read in full). Add a non-awaited `ensureWarm` after the not-found guard (lines 13-15) and before the `return`:
```typescript
export const load: PageServerLoad = async ({ params, url }) => {
  const row = db.select().from(agents).where(eq(agents.slug, params.slug)).get()
  if (!row) { error(404, '...') }
  const { inputSchema, ...agentRow } = row
  return { agent: { ...agentRow, ... }, openTryOut: url?.searchParams.get('tryout') === '1' }
}
```
Change: destructure `{ params, url, locals, cookies }`; `if (row.tryItOutMode === 'runnable') { void ensureWarm(sessionKey(...), row.slug).catch((e) => console.warn(...)) }`. DO NOT `await`. The `tryItOutMode` column exists (`drizzle/schema.ts` line 27, values `none | external | runnable`).

**Test pattern WARNING:** `src/routes/agents/detail.test.ts` calls `load({ params: { slug } })` with ONLY `params` (lines 71, 97, 123, 131) and mocks `@sveltejs/kit` and `$lib/server/db`. After this change those calls will have no `cookies`/`locals`. Either make the warm path tolerant of missing `locals`/`cookies` (guard on `row.tryItOutMode === 'runnable'` first, which fake rows lack) or update the call sites. Mock the new tryitout module in the new warm test (`vi.mock('$lib/server/tryitout/leaseManager', ...)`), asserting called-only-for-runnable, not awaited, and cookie set when auth off.

---

### `src/routes/api/tryitout/jobs/+server.ts` (modify)

**Analog:** itself. Handler signature (line 21) is `async ({ request })`; extend to `({ request, locals, cookies, url })` and pass `sessionKey(...)` into `createJob(agentId, task, file, key)` (line 46). Keep: validation order (400/400/400, 413), the `initialStatus` capture before `runJob` (lines 46-52), fixed server-chosen input path, and fire-and-forget `runJob(job.jobId).catch(() => {})` (line 65).

**Test caveat:** `jobs.test.ts` calls the handler as `asPostEvent(request)` = `{ request } as Parameters<typeof POST>[0]` (lines 67-69). The new handler reads `locals`/`cookies`, so update `asPostEvent` to supply `{ request, locals: { user: null }, cookies: fakeCookies, url: new URL(request.url) }`.

---

### `src/routes/api/tryitout/jobs/[id]/artifact/+server.ts` (modify: zip)

**Analog:** itself. Keep the 404/404/409 guards and the ENOENT-to-404 conversion (lines 15-33). Change only the file read (`artifactZipPath(params.id)`) and headers (lines 35-42):
```typescript
return new Response(new Uint8Array(buf), {
  headers: {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="aic-job-${params.id}.zip"`,
  },
})
```
Update `jobs.test.ts` lines 220-243 and 271-284, which currently assert `text/plain; charset=utf-8`, `.txt`, and plain-text bodies (`expect(text).toBe('artifact content here')`). Unzip with `fflate.unzipSync` in the new assertions and read `result.txt` out of the zip.

---

### `src/lib/tryItOut.ts` (modify body only)

Frozen signatures; change only line 99: `triggerBlobDownload(blob, \`aic-job-${safeFileToken(jobId)}.zip\`)` (RESEARCH Pitfall 10). Update `src/lib/tryItOut.test.ts` expectations for the download filename.

---

### `src/lib/server/tryItOutPrompts.ts` (modify: `SKILL.md`) and `data/tryitout-prompts/demo-rfi-triage/SKILL.md`

**Analog:** itself. `loadPromptFor` reads `join(PROMPTS_DIR, agentId, 'skill.md')` (line 53), validated by `AgentIdSchema.parse` first (line 43, the traversal guard T3-2; re-use it for every new path that embeds a slug). Change to `SKILL.md`, strip the YAML frontmatter before returning `skill` (so the fallback prompt composition still works), keep the real-cause error (lines 58-60). The `git mv` rename of the data file is required (it is tracked: `git ls-files data/tryitout-prompts`). The new file needs frontmatter `name: demo-rfi-triage` and `description: ...`; its body should read `input/task.txt` / `input/upload.txt` and write `output/result.txt` (the current body, lines 1-3, says "single model call... no other inputs" and must be rewritten; the body from line 5 onward, "Task", "Output format", "Hard constraints", is reusable). Update `tryItOutPrompts.test.ts` (it asserts `skill.length > 0` and mocks `readFile`) and add the frontmatter name/description assertion (RESEARCH Pitfall 9).
`composePrompt` (lines 66-83) is fallback-only and stays.

---

### `src/lib/server/tryitout/artifact.ts` (new, `zipOutputFiles`)

**Analog:** the path helper + fs write idiom in `tryItOutRunner.ts` lines 71-73 and `tryItOutJobs.ts` (`outputDir`, `assertValidJobId`):
```typescript
await mkdir(outputDir(jobId), { recursive: true })
await writeFile(outputFilePath(jobId), text, 'utf-8')
```
No tar or zip code exists in the repo. Use RESEARCH "Zip from getArchive" and Pattern 3 (regular files only, strip `output/`, reject `..`/absolute, cap 20 MB / 200 files, `fflate.zipSync`, write to `artifactZipPath(jobId)`). Export two entry points sharing the zip step: `zipTarStream(tarStream, jobId)` for the container path and `zipOutputDir(jobId)` for the fallback (read files under `outputDir(jobId)`).

---

### `src/lib/server/tryitout/runtimeDockerode.ts` and `runtime.ts`

**No close analog** (see below). Style references only:
- Error class with typed code: `AuthError` in `src/lib/server/auth.ts` lines 12-31 (`export class AuthError extends Error { constructor(public readonly code, message) { super(message) } }`). Copy this for `EngineUnavailable`, `ContainerStartFailed`, `Busy`.
- Lazy memoized client: `getClient()` in `tryItOutRunner.ts` lines 23-34 (never construct `Docker` at import).
- Only this file imports `dockerode` (RESEARCH anti-pattern list). Put the create-options builder in a pure exported function (`buildCreateOptions(cfg, ...)`) so `runtimeDockerode.test.ts` can assert `CapDrop ALL`, limits, tmpfs, labels, no `PortBindings` without Podman (D-21).

---

### `src/lib/server/tryitout/runtimeFake.ts` (new)

**Analog:** `src/lib/testing/fakeJobApi.ts` (tracked; an existing scriptable fake for the job API). Read it before writing the fake runtime to match its style (scriptable output, injected failures). Also the `__reset` pattern from `tryItOutJobs.ts`. The fake implements the same `ContainerRuntime` interface; D-15 requires tests never to use the OpenAI runner or Podman.

---

### `src/lib/server/tryitout/piEvents.ts` (new)

**No repo analog** (pure transform). Copy the JSONL splitter and completion tracker verbatim from RESEARCH "Code Examples" (lines 353-383). Event mapping table is RESEARCH R-04. Output type is `JobEvent` from `$lib/tryItOut` (`type: 'tool_start' | 'tool_end' | 'info'`, `tool?`, `summary`). Timestamp format: reuse the `nowTs()` helper in `tryItOutJobs.ts` lines 125-129 via `pushEvent`, so the mapper hands `{type, tool, summary}` to the extended `pushEvent` rather than generating `ts` itself.

---

### Tests (all new unit tests)

**Analog:** `src/lib/server/tryItOutRunner.test.ts` and `src/routes/api/tryitout/jobs/jobs.test.ts`.

**Env-before-import pattern (mandatory for anything touching `tryItOutJobs`)** (runner test lines 34-55):
```typescript
let tmpDir: string
let jobsMod: typeof import('./tryItOutJobs')
beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'tryitout-runner-test-'))
  process.env.TRYITOUT_WORK_DIR = tmpDir
  delete process.env.OPENAI_API_KEY // prove import-without-key never throws
  jobsMod = await import('./tryItOutJobs')
  ;({ runJob } = await import('./tryItOutRunner'))
})
afterAll(async () => {
  delete process.env.TRYITOUT_WORK_DIR
  await rm(tmpDir, { recursive: true, force: true })
})
beforeEach(() => { jobsMod.__resetJobs() })
```

**Hoisted mock for `openai`** (runner test lines 8-21): keep for the fallback tests only. In the container-path tests mock the runtime via the module interface (fake runtime), never `openai`. Because `runJob` now dispatches, existing runner and jobs tests that expect the direct-LLM behaviour must either force the fallback (inject a runtime stub that throws `EngineUnavailable`, with `PI_FALLBACK_ENABLED` on) or call `runDirectLlmJob` directly. Decide this once in the first plan and apply to `tryItOutRunner.test.ts` and `jobs.test.ts`; both have the `vi.mock('openai', ...)` boilerplate.

**Polling helpers to copy** (`waitForEvent`, runner test lines 71-81; `waitForStatus`, jobs test lines 89-103) for tests that fire `runJob` fire-and-forget.

**Route-handler test pattern** (`jobs.test.ts` lines 58-87): `makeForm`, `asPostEvent`, `asGetEvent`, `expectHttpError(fn, status)`. Reuse for the proxy route test (build a `Request` with `Authorization: Bearer`; mock global `fetch` for upstream; handler is called as `{ request }`).

**Page `load` test pattern:** `src/routes/agents/detail.test.ts` lines 4-28 (`vi.mock('$lib/server/db', ...)` chain mock, `vi.mock('drizzle-orm')`, `vi.mock('@sveltejs/kit')`) for the warm trigger test.

**Fake timers:** none used yet in the repo; for the reaper and idle TTL use `vi.useFakeTimers()` (vitest ^4).

**vitest config** (`vitest.config.ts`): `include: ['src/**/*.test.ts', 'scripts/**/*.test.ts']`, env `node`; the `$env/dynamic/private` import resolves through the sveltekit plugin, as in existing server tests. `scripts/smoke-pi-runner.ts` must NOT be named `*.test.ts`.

---

### `Containerfile.pi-runner` (new)

**Analog:** `Containerfile` (header comment with Build/Run lines, `ARG NODE_VERSION=22-bookworm-slim` (line 13), `apt-get install --no-install-recommends ... && rm -rf /var/lib/apt/lists/*` (lines 21-23), `USER node`):
```dockerfile
# syntax=docker/dockerfile:1
# Build:  podman build -t aic-agent-library -f Containerfile .
ARG NODE_VERSION=22-bookworm-slim
FROM node:${NODE_VERSION} AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
```
Follow that header/ARG/apt style; contents per RESEARCH "Compose/Containerfile changes" (pin `@earendil-works/pi-coding-agent@1.0.4`, `--ignore-scripts`, `ripgrep fd-find coreutils`, user `pi` uid 1000, `PI_OFFLINE/PI_SKIP_VERSION_CHECK/PI_TELEMETRY` env, `CMD ["sleep","infinity"]`). Pi needs Node >= 22.19; check that `22-bookworm-slim` resolves to >= 22.19 at build time.

Also update `.containerignore` if the new file or a new `scripts/` file matters (`.containerignore` is tracked).

### `podman-compose.yml` (modify)

**Analog:** itself. Current structure (lines 4-26): single `aic-agent-library` service, `env_file: .env`, `environment:` map using `"${VAR:-default}"` style (line 17), `volumes:` with `:U` suffix on named volumes (lines 20-21), top-level `volumes:` block. Add under the service: socket volume, `security_opt`, `userns_mode`, new env vars (same quoted `"${VAR:-default}"` style), `networks: [default, pi-internal]`, and a top-level `networks:` block (`pi-internal: { name: aic-pi-internal, internal: true }`). Add an `image: pi-runner` build entry only if the planner wants compose to build it (RESEARCH documents a manual `podman build`).

### `.env.example` and `README.md` (modify)

**Analog:** themselves. `.env.example` uses a leading comment line per variable and `# VAR=` commented examples for optional ones (e.g. lines for `SMTP_SERVER`). README "Trying out an agent" section (around lines 196-215) says "calls OpenAI... plain-text result download" and lists env vars the container respects; it must be rewritten for the container/zip flow (build `pi-runner`, socket mount, new `PI_*` knobs, fallback behaviour).

### `scripts/smoke-pi-runner.ts` (new)

**Analog:** `scripts/probe-openai-model.ts`: standalone, "NOT wired into test/build/dev", header comment with the run command (`npx tsx --env-file=.env scripts/...`), `main()` with explicit `console.error` + `process.exit(1)` on failure, prints a captured report. Copy that structure for the live spike (putArchive into tmpfs/ReadonlyRootfs, exec demux, DNS on the internal network).

### `package.json` (modify)

`dockerode`, `tar-stream`, `fflate` go in `dependencies` (runtime image uses `npm prune --omit=dev`, `Containerfile` line 45, so anything the server imports at runtime MUST be a dependency, not a devDependency); `@types/dockerode` in `devDependencies`. Existing style: caret ranges (`"openai": "^7.5.0"`).

## Shared Patterns

### Server-only module header + lazy env
**Source:** `src/lib/server/tryItOutRunner.ts` lines 1-3, 23-34
**Apply to:** every new `src/lib/server/**` file
Two-line header comment, then imports; no secret or engine connection at module top level. Read `OPENAI_API_KEY` and engine config inside functions (`env.X ?? process.env.X`).

### Identifier validation before any path or DB use
**Source:** `src/lib/server/tryItOutPrompts.ts` lines 23-27, 43; `src/lib/server/tryItOutJobs.ts` lines 38-51
**Apply to:** `piRunner`, `artifact`, lease manager (slug used in container labels, `/work/<jobId>` paths, `skills/<slug>` paths)
```typescript
export const AgentIdSchema = z.string().min(1).max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
...
AgentIdSchema.parse(agentId)   // BEFORE db lookup or filesystem read
```
```typescript
const JOB_ID_RE = /^[0-9a-f]{8}-...-[0-9a-f]{12}$/i
function assertValidJobId(id: unknown): asserts id is string { if (!isValidJobId(id)) throw new Error(`invalid jobId: ${id}`) }
```
In-container paths built from `jobId` must come from `isValidJobId`-checked ids (the tar entry names and the `WorkingDir` too).

### Fire-and-forget with self-recorded failure
**Source:** `src/routes/api/tryitout/jobs/+server.ts` lines 62-65; `tryItOutRunner.ts` lines 77-82
**Apply to:** warm trigger (`void ensureWarm(...).catch(log)`), `runJob` call, proxy usage accounting
```typescript
runJob(job.jobId).catch(() => {})
```
`runJob` never rejects to the caller; failures are written into the job store as `failed` plus a real error string. Warm failures are logged (`console.warn`) and never surface to the page render.

### Token and secret hygiene
**Source:** `src/lib/server/auth.ts` lines 2, 60, 213, 225
**Apply to:** LLM proxy token registry, session cookie id
`randomBytes(32).toString('base64url')` to mint, `createHash('sha256')` to index, `timingSafeEqual` to compare. Never use `Math.random`, never log tokens.

### Cookie options
**Source:** `src/lib/server/auth.ts` lines 289-299 (`authCookieOptions(url, expiresAt?)`)
**Apply to:** `session.ts` anon cookie (`aic_tryout_sid`)

### Error responses
**Source:** `src/routes/api/try-out/+server.ts` lines 33-41, 73-76 (JSON `{ message }` with status; `console.error` plus generic message on 500); `src/routes/api/tryitout/jobs/+server.ts` lines 27-44 (`error(400|413, '...')` from `@sveltejs/kit`)
**Apply to:** job routes keep `error(...)`; the new proxy route returns OpenAI-shaped `json({ error: { message } }, { status })` (clients such as Pi parse that shape)

### Env-before-import test setup and `__reset*` hooks
**Source:** `tryItOutRunner.test.ts` lines 34-61; `tryItOutJobs.ts` lines 116-120
**Apply to:** all new tests touching jobs/lease/proxy state; every new singleton exports a `__reset*()` helper

### Env knob style
**Source:** `tryItOutJobs.ts` line 21, `tryItOutPrompts.ts` line 29; `Containerfile` lines 50-56
**Apply to:** `config.ts`, `Containerfile`, `podman-compose.yml`, `.env.example`
`process.env.NAME ?? <default>` with the default documented next to it and the container-side value set in `Containerfile` `ENV` (note `HOST=0.0.0.0` is already set, required for the Pi to app proxy path).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/lib/server/tryitout/runtimeDockerode.ts` | service | streaming (exec demux, tar archives) | No Docker/Podman or stream-demux code anywhere; use RESEARCH Patterns 2, 3 and "Container create (dockerode)" |
| `src/lib/server/tryitout/piEvents.ts` | utility | streaming/transform (JSONL) | No streaming parsers in repo; copy RESEARCH "JSONL line splitter" and "Completion tracker" |
| `src/lib/server/tryitout/leaseManager.ts` (timers/reaper/globalThis HMR guard, orphan sweep) | service | event-driven | Only the Map-singleton idea has an analog (`tryItOutJobs.ts`); no `setInterval`, `globalThis`, or `process.once` use exists; use RESEARCH Pattern 1 and Pattern 7 |
| `src/routes/api/llm/v1/chat/completions/+server.ts` (SSE passthrough, `tee()` usage accounting, `request.signal` abort) | route | streaming | No streaming `Response` route exists; use RESEARCH Pattern 4 |
| `src/lib/server/tryitout/artifact.ts` tar/zip internals | utility | transform | No tar/zip code in repo; use RESEARCH "Zip from getArchive" |
| `src/hooks.server.test.ts` | test | request-response | No hooks test exists (only the hook itself); build a fake `RequestEvent` as described above |

## Metadata

**Analog search scope:** `src/lib/server/`, `src/lib/`, `src/lib/testing/`, `src/routes/api/**`, `src/routes/agents/**`, `src/routes/login/`, `src/hooks.server.ts`, `scripts/`, `data/tryitout-prompts/`, `Containerfile`, `podman-compose.yml`, `.env.example`, `README.md`, `package.json`, `vitest.config.ts`
**Files scanned:** about 35 (`git ls-files` inventory plus 22 full or partial reads)
**Tracked-source gate:** all analog paths above appear in `git ls-files`. `.tryitout-work/` and `runtime/` are gitignored runtime dirs and are never referenced as analogs.
**Pattern extraction date:** 2026-10-08
