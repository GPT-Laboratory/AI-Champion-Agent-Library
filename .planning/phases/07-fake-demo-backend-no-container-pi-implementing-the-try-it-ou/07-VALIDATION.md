---
phase: 07
slug: fake-demo-backend-no-container-pi-implementing-the-try-it-ou
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-19
---

# Phase 07 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.0 |
| **Config file** | `vitest.config.ts` (project root) — `environment: 'node'` by default, `jsdom` only for `src/lib/components/**` |
| **Quick run command** | `npx vitest run <path-to-file>` |
| **Full suite command** | `npm test` (== `vitest run`) |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <changed test file>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green, plus one real manual end-to-end run (upload a sample RFI `.txt`, confirm staged progress lines appear in order, confirm download works) — this phase's core value (a real LLM call producing a sane triage result) can only be honestly confirmed against the real deployed API key, not by mocked unit tests alone.
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-xx | TBD | TBD | SC-01 | T-07-xx / — | `jobId` generated via `crypto.randomUUID()`, no container/`pi` process spawned | unit | `npx vitest run src/lib/server/tryItOutJobs.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-xx | TBD | TBD | SC-02 | T-07-xx / — | Uploaded file written under `.tryitout-work/<jobId>/input/` | unit (real tmp-scoped filesystem) | `npx vitest run src/lib/server/tryItOutRunner.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-xx | TBD | TBD | SC-03 | T-07-xx / — | Base prompt (DB `agents.systemPrompt`) AND `skill.md` both loaded and concatenated into the model input | unit (mocked `openai` client) | `npx vitest run src/lib/server/tryItOutPrompts.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-xx | TBD | TBD | SC-04 | T-07-xx / — | Status transitions `queued → running → succeeded`/`failed`; real error string on failure (no fabricated `pi`-style message) | unit (mocked `openai` client, real job store) | `npx vitest run src/lib/server/tryItOutRunner.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-xx | TBD | TBD | SC-05 | T-07-xx / — | Staged `info`-typed events only (`reading input…` / `calling model…` / `writing output…`), never `tool_start`/`tool_end` | unit | `npx vitest run src/lib/server/tryItOutRunner.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-xx | TBD | TBD | SC-06 | T-07-xx / — | GET status and GET artifact endpoints return correct shapes; artifact download only served when `status: 'succeeded'` | integration (call exported `GET`/`POST` handlers directly) | `npx vitest run src/routes/api/tryitout/jobs/jobs.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-xx | TBD | TBD | SC-07 | T-07-xx / — | `tryItOut.ts` calls real routes via `fetch`; frozen signatures unchanged; UI components unchanged | unit (mocked global `fetch`) + existing regression | `npx vitest run src/lib/tryItOut.test.ts src/routes/agents/try-it-out.test.ts` | Partial — regression file exists (Phase 6); new unit test ❌ W0 | ⬜ pending |
| 07-01-xx | TBD | TBD | SC-08 | T-07-xx / — | `jobId` persists via `?job=` URL param and survives a refresh in the same session | manual/smoke (no e2e harness in this repo) | manual browser refresh check | ❌ W0, optional | ⬜ pending |
| 07-01-xx | TBD | TBD | SC-09 | T-07-xx / — | `OPENAI_API_KEY` never referenced in client-bundled code | static check | `grep -rn "OPENAI_API_KEY" src/routes/**/*.svelte src/lib/components` (must return nothing) | N/A — verification step | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/server/tryItOutJobs.test.ts` — job store create/get/pushEvent/setStatus behavior
- [ ] `src/lib/server/tryItOutRunner.test.ts` — staged-event ordering, success/fail status transitions, mocked `openai` client
- [ ] `src/lib/server/tryItOutPrompts.test.ts` — base-prompt (DB) + skill.md (file) both loaded and concatenated correctly for `demo-rfi-triage`
- [ ] `src/routes/api/tryitout/jobs/jobs.test.ts` — POST/GET/artifact handler behavior called directly (no full HTTP server needed)
- [ ] `src/lib/tryItOut.test.ts` — new unit test for the real `fetch()`-based client bodies with a mocked global `fetch`
- [ ] `.gitignore` — add `.tryitout-work/` (new runtime working directory, must never be committed)
- [ ] `data/agents/demo-rfi-triage.yaml` and `data/tryitout-prompts/demo-rfi-triage/skill.md` — new fixture-like content the tests above depend on

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `jobId` persists across a browser refresh mid-session | SC-08 | No Playwright/e2e harness present in this repo | Start a job, note the `?job=<jobId>` URL, refresh the page, confirm the panel restores the in-progress or finished view and the download button (if succeeded) still works |
| Full end-to-end demo run against the real deployed API key | All | Mocked unit tests verify the code path, not that the deployed model/key actually produces a sane triage output | Upload a sample RFI `.txt` file through the UI, confirm staged progress lines appear in order (`reading input…` → `calling model…` → `writing output…` → terminal), confirm the download returns a real triage result |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
