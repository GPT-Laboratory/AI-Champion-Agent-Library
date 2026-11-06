---
phase: 07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou
verified: 2026-08-20T15:10:00Z
status: passed
score: 9/9 must-haves verified
---

# Phase 07: No-Container Demo Backend for Try It Out Verification Report

**Phase Goal:** Replace the mock-backed Try It Out client with a real (but "cheating") demo backend: no Docker, no `pi`, no parallelism, no worker containers — plain SvelteKit server routes that actually call an LLM, with job state in server memory, client-persisted `jobId`, and the LLM provider/key confined to the server.
**Verified:** 2026-08-20T15:10:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth (Success Criterion) | Status | Evidence |
|---|---|---|---|
| SC-01 | `POST /jobs` creates a `jobId` acting as a fake container ID; no container/`pi` started | ✓ VERIFIED | `src/lib/server/tryItOutJobs.ts:82` uses `randomUUID()` from `node:crypto`. `grep -rnE "child_process|spawn\(|exec\(|docker"` across `src/lib/server/tryItOut*.ts` and `src/routes/api/tryitout/` returns zero matches. |
| SC-02 | Uploaded file written to a jobId-prefixed server folder | ✓ VERIFIED | `inputFilePath(jobId)` = `.tryitout-work/<jobId>/input/input.txt` (fixed, never derived from `File.name`). `+server.ts:58-59` writes via `mkdir`/`writeFile` to that exact path before firing the runner. |
| SC-03 | Backend loads BOTH the hardcoded base prompt AND the agent's `skill.md`, passes both + uploaded file to the model | ✓ VERIFIED | `tryItOutPrompts.ts`'s `loadPromptFor` reads `agents.systemPrompt` (DB) and `data/tryitout-prompts/<agentId>/skill.md` (file); `composePrompt` concatenates base prompt + skill + delimiter + input text, consumed by `tryItOutRunner.ts:63`. `demo-rfi-triage.yaml` and its `skill.md`/`sample-rfi.txt` exist on disk and are DB-ingested (`try_it_out_mode='runnable'` confirmed live). |
| SC-04 | Backend calls the LLM, writes an output file, status goes `queued -> running -> succeeded` (or `failed` with a real error string) | ✓ VERIFIED | `tryItOutRunner.ts`'s `runJob`: `setStatus('running')` before any await, real `client.responses.create()` call, `writeFile(outputFilePath(...), text)`, terminal `setStatus('succeeded')`/`setStatus('failed', err.message)` — no fabricated `pi exited` strings anywhere (grep confirms). Live-verified: `.planning/.../07-05-SUMMARY.md` records two real on-disk job outputs from an actual browser run against the deployed OpenAI key, producing genuine input-specific triage text. |
| SC-05 | Progress is staged status only (no live tool-event feed); download brightens on success | ✓ VERIFIED | `pushEvent` in `tryItOutJobs.ts` always constructs `{ type: 'info', ... }` — no code path can emit `tool_start`/`tool_end`. `TryItOutPanel.svelte:148` renders the Download button only when `status === 'succeeded' && jobId`. |
| SC-06 | GET status and GET artifact work; download returns the real generated result | ✓ VERIFIED | `src/routes/api/tryitout/jobs/[id]/+server.ts` returns the literal `{ status, events, error }`; `.../artifact/+server.ts` returns the real `result.txt` bytes with `Content-Disposition: attachment`, 409 pre-success, 404 unknown/missing. 19 route tests pass; live-verified download in 07-05-SUMMARY.md. |
| SC-07 | `src/lib/tryItOut.ts` calls the routes via `fetch`; UI components (incl. Phase 6 panel) unchanged | ✓ VERIFIED (with noted scope resolution) | `tryItOut.ts` reaches `/api/tryitout/jobs*` exclusively via `fetch()`, frozen signatures/types preserved byte-identical. `TryItOutPanel.svelte`'s markup (`<aside>...</aside>`) is untouched; only the `<script>` block gained the additive `?job=` restore/persist wiring required by SC-08 (explicitly flagged as tension A-4 in 07-05-PLAN.md and resolved: "unchanged" scoped to the mock→real swap, which touched zero UI files in plan 07-04). The Phase 6 transport-discipline guard test (no `fetch(`, no `EventSource`, no absolute URL, no `{@html}`) passes byte-identical. |
| SC-08 | `jobId` persisted client-side, survives refresh in the same session; finished result/download remain available | ✓ VERIFIED | `src/lib/tryItOutSession.ts` (`readJobIdFromUrl`/`writeJobIdToUrl`/`clearJobIdFromUrl`, UUID-validated, transport-free) wired additively into the panel's mount effect and `run()`. Stale-id (404) degrades to idle, not a false failure. Live-verified: 07-05-SUMMARY.md records the user confirming refresh persistence mid-run, post-run, cross-tab, and stale-job behaviors ("approved" on the 12-step script). |
| SC-09 | LLM provider/key supplied server-side only, never sent to the client | ✓ VERIFIED | `grep -rn "OPENAI_API_KEY" src/lib/components/ src/lib/tryItOut.ts src/routes` → no matches. Key read only in `tryItOutRunner.ts`'s lazily-constructed `getClient()`. Proven against the actual built output: `grep -rc "OPENAI_API_KEY" build/client/` and `grep -rn "calling model" build/client/` both return zero matches (re-run live during this verification, not just cited from the SUMMARY). |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/lib/server/tryItOutModel.ts` | `MODEL`/`TEMPERATURE`/`modelParams()` frozen from live probe | ✓ VERIFIED | `MODEL = 'gpt-4.1-mini'`, `TEMPERATURE = 0.2`, backed by `MODEL-PROBE.md`. No key read here. |
| `scripts/probe-openai-model.ts`, `MODEL-PROBE.md` | Reproducible live probe + recorded output | ✓ VERIFIED | Both exist; probe never wired into `test`/`build`/`dev`. |
| `data/agents/demo-rfi-triage.yaml` | Demo-only agent, DEMO ONLY disclaimer, no `try_it_out` key | ✓ VERIFIED | Confirmed by direct read — disclaimer present, no tools, no `try_it_out` field. |
| `data/tryitout-prompts/demo-rfi-triage/skill.md` + `sample-rfi.txt` | Shipped skill file + demo fixture | ✓ VERIFIED | Both present, skill.md encodes urgency/discipline/routing/rationale task. |
| `scripts/set-try-it-out-mode.ts` | One-off idempotent DB mode flip | ✓ VERIFIED | Live DB queried: `demo-rfi-triage`→`runnable`, `hvac-load-calculator`→`none`. |
| `src/lib/server/tryItOutJobs.ts` | Job store + path helpers, traversal-proof | ✓ VERIFIED | `isValidJobId` UUID guard on every path helper; `fileName` never joined into a path. |
| `src/lib/server/tryItOutPrompts.ts` | Prompt loader + composer | ✓ VERIFIED | `AgentIdSchema` validated before DB/FS touch; `composePrompt` places input last behind a non-instruction delimiter. |
| `src/lib/server/tryItOutRunner.ts` | Staged fire-and-forget runner | ✓ VERIFIED | Lazy `getClient()`, real `responses.create()`, real error strings, no rethrow. |
| `src/routes/api/tryitout/jobs/+server.ts` | `POST` handler | ✓ VERIFIED | 200KB cap enforced pre-write, fixed-path upload write, fire-and-forget `runJob`. |
| `src/routes/api/tryitout/jobs/[id]/+server.ts` | `GET` status | ✓ VERIFIED | Literal `{status,events,error}`, 404 on invalid/unknown id. |
| `src/routes/api/tryitout/jobs/[id]/artifact/+server.ts` | `GET` artifact | ✓ VERIFIED | 409/404/200 branches, correct headers. |
| `src/lib/tryItOut.ts` | Real fetch client, frozen contract | ✓ VERIFIED | Mock deleted wholesale; signatures/types byte-identical to `docs/job-api-contract.md`. |
| `src/lib/tryItOutSession.ts` | `?job=` session helper | ✓ VERIFIED | UUID-validated, transport-free, router-optional no-op. |
| `src/lib/components/TryItOutPanel.svelte` | Additive restore/persist wiring | ✓ VERIFIED | `<script>`-only diff; markup untouched. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `tryItOutRunner.ts` | OpenAI Responses API | `client.responses.create({model: MODEL, ...modelParams(), input})` | ✓ WIRED | Confirmed at line 60-64; live-fired in the 07-05 human checkpoint producing real triage output. |
| `tryItOutPrompts.ts` | `agents.system_prompt` | `db.select().from(agents).where(eq(agents.slug, agentId))` | ✓ WIRED | Confirmed at line 45. |
| `tryItOutPrompts.ts` | `data/tryitout-prompts/<agentId>/skill.md` | `readFile(...)` | ✓ WIRED | Confirmed at line 53-56. |
| `+server.ts` (POST) | `tryItOutRunner.runJob` | fire-and-forget `runJob(job.jobId).catch(()=>{})` | ✓ WIRED | Confirmed at line 65. |
| `[id]/artifact/+server.ts` | `.tryitout-work/<jobId>/output/result.txt` | `readFile(outputFilePath(id))` | ✓ WIRED | Confirmed at line 30, with `Content-Disposition` header. |
| `tryItOut.ts` | `/api/tryitout/jobs*` | real `fetch()` calls | ✓ WIRED | Confirmed at lines 37, 56, 94 — POST, GET status, GET artifact. |
| `TryItOutPanel.svelte` | `tryItOutSession.ts` | `readJobIdFromUrl` on mount, `writeJobIdToUrl` after submit | ✓ WIRED | Confirmed at lines 5, 67, 82-87. |

### Requirements Coverage

No requirement IDs (`REQ-*`) are assigned to this phase in `.planning/REQUIREMENTS.md` (confirmed via grep — zero matches for this phase). Scope is defined entirely by the ROADMAP success criteria (SC-01 through SC-09), which are covered in the Observable Truths table above. No orphaned requirements found.

### Anti-Patterns Found

None. Scanned all phase-07 source files (`tryItOutModel.ts`, `tryItOutJobs.ts`, `tryItOutPrompts.ts`, `tryItOutRunner.ts`, the three route handlers, `tryItOut.ts`, `tryItOutSession.ts`, `TryItOutPanel.svelte`) for `TODO`/`FIXME`/`PLACEHOLDER`/empty-return/console-log-only patterns. The only matches were legitimate: `.catch(() => {})` (deliberate fire-and-forget per SC-01/SC-04 design, with the runner recording its own failure), `return null` (legitimate SSR-guard/no-match return values in `tryItOutSession.ts`), and a `placeholder="..."` HTML textarea attribute (unrelated to code stubs).

### Independent Re-verification Performed (not just re-reading summaries)

- `npm test`: 200/200 passing, 0 skipped (re-run live).
- `npx tsc --noEmit`: 22 errors, all in pre-existing unrelated files (`catalog.test.ts`, `try-it-out.test.ts`, `detail.test.ts`, and 2 unused `@ts-expect-error` directives in `tryItOut.test.ts` carried over from Phase 6) — zero errors in any phase-07 source file (re-run live, matches the documented 22-error baseline).
- `npm run build`: succeeds (re-run live).
- SC-09 bundle proof re-run live against actual `build/client/` output: `grep -rc "OPENAI_API_KEY" build/client/` and `grep -rn "calling model" build/client/` both return zero matches.
- Live DB query re-run: `demo-rfi-triage` = `runnable`, `hvac-load-calculator` = `none`.
- Direct source reads of every artifact in the table above (not just SUMMARY claims) confirm the code matches what each SUMMARY reports.

### Human Verification Required

None outstanding. The phase's one item requiring a human (SC-04's live, input-specific LLM output; SC-08's browser refresh/cross-tab/stale-job behaviors) was already executed and confirmed by the actual user in the 07-05 checkpoint ("approved" on all 12 steps), with independently corroborating on-disk artifact evidence (two real `.tryitout-work/<jobId>/output/result.txt` files containing genuine, input-specific triage text) quoted verbatim in `07-05-SUMMARY.md`. This satisfies the human-verification requirement for SC-04/05/06/08 per this verification's instructions.

### Gaps Summary

No gaps. All 9 ROADMAP success criteria are verified against the actual codebase (not just SUMMARY claims), all artifacts exist and are substantive (no stubs), all key links are wired, the full test suite passes (200/200), `tsc`/`build` are clean modulo a documented pre-existing unrelated baseline, and the SC-09 server-only-key guarantee is proven against the real built client bundle. The one interpretive tension (SC-07's "UI unchanged" wording vs. SC-08's required additive session wiring) was explicitly flagged and resolved by the phase's own planning (A-4 in 07-05-PLAN.md) with a defensible, minimal-diff resolution: zero markup changes, unmodified transport-discipline guard test, additive script-only wiring — treated here as satisfying the intent of SC-07 rather than a gap.

---
*Verified: 2026-08-20T15:10:00Z*
*Verifier: Claude (gsd-verifier)*
