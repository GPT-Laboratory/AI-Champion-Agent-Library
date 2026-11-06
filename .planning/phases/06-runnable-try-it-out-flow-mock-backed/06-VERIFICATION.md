---
phase: 06-runnable-try-it-out-flow-mock-backed
verified: 2026-08-19T13:11:32Z
status: passed
score: 6/6 must-haves verified
---

# Phase 6: Runnable Try It Out Flow (mock-backed) Verification Report

**Phase Goal:** Build a mock-backed, contract-shaped "Try It Out" runnable flow that demos end-to-end with no real backend: a client layer (`src/lib/tryItOut.ts`) exposing exactly `submitJob`, `subscribeProgress`, and `downloadArtifact` per `docs/job-api-contract.md`'s frozen signatures, and a Svelte 5 `TryItOutPanel.svelte` wired into the agent detail page's runnable mode (replacing Phase 5's disabled placeholder button), also usable standalone with a hardcoded agentId. Swapping mock → real backend later must touch only `tryItOut.ts`, never the UI.

**Verified:** 2026-08-19T13:11:32Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Phase 6 Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `src/lib/tryItOut.ts` exposes exactly `submitJob`, `subscribeProgress`, `downloadArtifact` — mock-backed, contract-shaped; a real-backend swap touches only this file | ✓ VERIFIED | `grep -n "^export" src/lib/tryItOut.ts` returns exactly 3 functions + 4 types (`JobStatus`, `JobEvent`, `JobUpdate`, `SubmitResult`, `submitJob`, `subscribeProgress`, `downloadArtifact`). All mock internals (`mockJobs`, `SUCCESS_SCRIPT`, `FAIL_PATTERN`, `nowTs`, `runMockScript`, `triggerTextDownload`, etc.) sit below a single literal `MOCK IMPLEMENTATION — DELETE WHOLESALE` banner comment (line 52). |
| 2 | Mock progress events look like real `pi` `tool_execution` output, with `HH:MM:SS` timestamps | ✓ VERIFIED | `SUCCESS_SCRIPT` in `tryItOut.ts` contains the exact contract lines `read data/sample.csv`, `read data/sample.csv (12 lines)`, `count rows in data/sample.csv`, `write output/result.txt`; `nowTs()` builds `HH:MM:SS` via `padStart`, not locale APIs. Human-confirmed as reading like an authentic log in 06-03-SUMMARY.md step 2 ("Approved"). |
| 3 | `TryItOutPanel.svelte` renders a task textarea, optional file input, Run button, live auto-scrolling progress feed, a "Download results" button on success, and a red failed state showing the error | ✓ VERIFIED | All elements present in `TryItOutPanel.svelte`: `<textarea id="tryitout-task">` (line 61), `<input type="file" id="tryitout-file">` (line 71-76, no `multiple`), `<button onclick={run}>` (line 78), auto-scrolling feed div with `max-h-64 overflow-y-auto ... font-mono` + `bind:this={feedEl}` and a `$effect` writing `scrollTop` (lines 45-48, 89-98), `Download results` button guarded by `status === 'succeeded' && jobId` (lines 101-109), red `Job failed` block guarded by `status === 'failed'` with `bg-red-50/border-red-200/text-red-700` and verbatim `{error}` interpolation (lines 111-117). 20 passing tests in `TryItOutPanel.test.ts` exercise all of these. Human-confirmed visually in 06-03 checkpoint steps 1-6. |
| 4 | A task containing the word "fail" exercises the failed path so both outcomes are demoable with no code changes | ✓ VERIFIED | `FAIL_PATTERN = /(^|\W)fail(\W|$)/i` in `tryItOut.ts` (exact contract regex). Table-driven tests (`it.each`) in `tryItOut.test.ts` cover 5 must-fail and 4 must-succeed cases. `TryItOutPanel.test.ts` T2.6/T2.7 drive both outcomes through the UI. Human-confirmed in 06-03 checkpoint step 5. |
| 5 | The panel is wired into the runnable-mode agent detail page AND works standalone with a hardcoded agentId | ✓ VERIFIED | `src/routes/agents/[slug]/+page.svelte` line 75-79: `{#if agent.tryItOutMode === 'runnable'}<TryItOutPanel agentId={agent.slug} />{/if}`, replacing the Phase 5 disabled-button block (`grep -n "Try it out is not yet available"` returns no matches). `TryItOutPanel.svelte` defaults `agentId = 'demo-agent'` (line 8) and `render(TryItOutPanel)` with zero props passes a full run-to-succeeded test (`TryItOutPanel.test.ts` "works standalone with no props at all", line 89). Human-confirmed the wired path in 06-03 checkpoint step 1. |
| 6 | No real backend exists; the UI only ever calls the three client functions — no `fetch`/`EventSource`/endpoint references anywhere else in the UI | ✓ VERIFIED | `grep -rnE "fetch\(|EventSource|XMLHttpRequest|https?://|\{@html" src/lib/components src/routes` returns no matches in any production file (only test-fixture URL strings and test-assertion regex literals match). `COVERAGE.md` declares and grep-verifies no external API integration. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/tryItOut.ts` | Frozen 3-function/4-type client API, mock internals isolated below delete-wholesale banner | ✓ VERIFIED | 173 lines. Exactly 3 exported functions + 4 exported types. Banner present at line 52; `mockJobs`, `SUCCESS_SCRIPT`, `FAIL_PATTERN`, `nowTs`, `triggerTextDownload` all declared below it. |
| `src/lib/tryItOut.test.ts` | Fake-timer unit tests: submit delay, event script, fail regex, unsubscribe, download blob, unknown-job | ✓ VERIFIED | 219 lines, 19 test instances (10 `it()` + 9 `it.each` rows) via `vi.advanceTimersByTimeAsync`. All pass (`npx vitest run` confirmed). |
| `src/lib/components/TryItOutPanel.svelte` | Svelte 5 runes panel: task textarea, file input, Run button, feed, download button, failed block | ✓ VERIFIED | 118 lines. Contains `$state`, `$derived`, `$effect`, `$props()`; no `export let`/`$:`. Wired to `submitJob`/`subscribeProgress`/`downloadArtifact` only. |
| `src/lib/components/TryItOutPanel.test.ts` | jsdom render tests for success/fail flows, standalone, transport discipline, cleanup | ✓ VERIFIED | 438 lines, 20 tests, all pass. Includes T2.17-T2.20 unmount/terminal/re-run cleanup tests using `vi.getTimerCount()`. |
| `src/routes/agents/[slug]/+page.svelte` | Runnable-mode wiring replacing the disabled button | ✓ VERIFIED | Line 4 import, lines 75-79 `<TryItOutPanel agentId={agent.slug} />`; `external`/`none`/malformed branches (lines 63-72) untouched. |
| `.planning/phases/06-runnable-try-it-out-flow-mock-backed/COVERAGE.md` | Reasoned no-external-API declaration | ✓ VERIFIED | Exists, contains literal string "No external API integration", no fabricated capability matrix. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `TryItOutPanel.svelte` | `src/lib/tryItOut.ts` | `import { submitJob, subscribeProgress, downloadArtifact } from '$lib/tryItOut'` | ✓ WIRED | Line 2 of `TryItOutPanel.svelte`; the only data path the panel has. |
| `TryItOutPanel run()` | `subscribeProgress` `onUpdate` callback | `status`/`events`/`error`/`jobId` assigned into `$state` | ✓ WIRED | Lines 33-41; feed re-renders on every update, unsubscribes on terminal status. |
| `src/routes/agents/[slug]/+page.svelte` runnable branch | `TryItOutPanel.svelte` | `agentId={agent.slug}` prop | ✓ WIRED | Line 77: `<TryItOutPanel agentId={agent.slug} />`. |
| File input `onchange` | `submitJob(agentId, task, file)` | `$state` `file` variable passed as third argument | ✓ WIRED | Line 30: `submitJob(agentId, task, file)`; file's name provably reaches the downloaded artifact (`TryItOutPanel.test.ts` T2.13, human-confirmed step 4). |
| Download results button | `downloadArtifact(jobId)` | `onclick` with captured `jobId` | ✓ WIRED | Line 104: `onclick={() => downloadArtifact(jobId!)}`. |
| `JobUpdate.error` | red failed-state block | escaped `{error}` interpolation | ✓ WIRED | Line 114: `<p ...>{error}</p>` inside `bg-red-50`/`border-red-200`/`text-red-700`; no `{@html}` anywhere (grep-confirmed). |

### Requirements Coverage

No requirement IDs are assigned to Phase 6. `.planning/REQUIREMENTS.md`'s traceability table has no Phase 6 (or Phase 5) rows at all — it was last updated 2026-03-19, before Phases 5/6 were added to the roadmap. `.planning/ROADMAP.md`'s Phase 6 section explicitly states `Requirements: none assigned (scope defined by docs/job-api-contract.md and user-specified success criteria below)`, and both PLAN frontmatters (`06-01`, `06-02`, `06-03`) carry `requirements: []` with an explanatory comment pointing at `success_criteria_covered` instead. This is confirmed as an intentional scope choice, not a dropped mapping — no requirement ID exists anywhere in `REQUIREMENTS.md` that names or implies this phase's runnable-flow scope.

One informational note: `REQUIREMENTS.md`'s "Out of Scope" table lists `Execution sandbox / demo` — "Requires runtime infrastructure; explicitly out of scope" — a v1-era decision predating this phase's existence. Phase 6 builds a client-side *mock* of a runnable demo (no real execution, no runtime infra, explicitly documented as such in `docs/job-api-contract.md` and `COVERAGE.md`), so it does not contradict that out-of-scope line, but the stale `REQUIREMENTS.md` document was never updated to reflect the roadmap's evolution through Phases 5-6. This is a documentation-hygiene gap in the planning corpus, not a phase-6 implementation gap.

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| (none assigned) | 06-01, 06-02, 06-03 | N/A | N/A | Confirmed intentional per ROADMAP.md Phase 6 header and REQUIREMENTS.md's absence of any Phase 5/6 rows |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/components/TryItOutPanel.svelte` | 22-42 (`run()`) | No `destroyed` flag guarding the post-`await submitJob` continuation; unmounting during the ~400ms submit delay leaves `subscribeProgress` uncancelled (WR-01 in 06-REVIEW.md, unfixed) | ⚠️ Warning | Narrow race: destroying the panel in the ~400ms window between clicking Run and `submitJob` resolving lets a `subscribeProgress` call start after unmount, scheduling timers that fire into a destroyed component for up to 4s. Not exercised by the checkpoint (which stayed on-page) or the test suite's unmount test (which unmounts after 1000ms, i.e. after the 400ms window closes). Reviewed and explicitly accepted as non-blocking in 06-REVIEW.md. |
| `src/lib/components/TryItOutPanel.svelte` | 30 (`run()`) | No try/catch around `await submitJob(...)` (WR-02 in 06-REVIEW.md, unfixed) | ⚠️ Warning | The mock never rejects today, so this is latent, not currently reachable. Will strand the Run button in a disabled "Running…" state forever the moment a real backend rejects a promise — directly relevant to this phase's stated goal that a mock→real swap "must touch only tryItOut.ts, never the UI." A rejecting real backend would in fact require touching the UI to add error handling. Reviewed and explicitly accepted as non-blocking (mock-only scope) in 06-REVIEW.md. |
| `src/routes/agents/[slug]/+page.svelte` | 63-72 | `href={agent.tryItOutUrl}` rendered with no scheme validation (WR-03 in 06-REVIEW.md, unfixed) | ⚠️ Warning | `tryItOutMode: 'external'` link could render a `javascript:` URI if a malformed/malicious AgentSpec entry set `tryItOutUrl` to one. This branch is Phase 5 code untouched by Phase 6 (D-14 required byte-identical behavior), so it is a pre-existing Phase 5 condition, not introduced here — flagged for completeness since 06-REVIEW.md reviewed this file as part of Phase 6's file set. |

None of the three warnings are blockers: all were surfaced and explicitly triaged as non-blocking in `06-REVIEW.md` (0 critical, 3 warnings), and none contradict any of the phase's 6 observable truths or ROADMAP success criteria — they represent latent robustness gaps for a *future* real-backend swap, which is explicitly out of scope for this mock-backed phase.

### Human Verification Required

None outstanding. The phase's designated human checkpoint (06-03 Plan Task 2 — a 10-step browser walkthrough covering panel wiring, both success/fail outcomes, download, file attachment, the two UI-SPEC backstop items (overflow/long-text), console-clean navigation-away, Phase 5 regression check, and tablet viewport) was already performed and explicitly approved by the user with no defects reported, per `06-03-SUMMARY.md`. That account is internally consistent with the actual code: every DOM element, class, and copy string the checkpoint script asked the human to look for is present and verified in the current `TryItOutPanel.svelte` and `+page.svelte` source, and the automated baseline the SUMMARY reports (48 tests, `vite build` success) matches what was independently re-run during this verification.

### Gaps Summary

No gaps. All 6 ROADMAP Phase 6 success criteria are verified true against the actual codebase (not just claimed in SUMMARYs): the frozen 3-function/4-type client API exists with all mock internals isolated below a delete-wholesale banner; mock progress events use the exact contract summary strings and `HH:MM:SS` timestamps; the panel renders every required element (task textarea, optional file input, Run button, auto-scrolling feed, Download results button, red failed block) using Svelte 5 runes; the fail-path regex is the exact contract regex and both outcomes are reachable with no code changes; the panel is wired into the runnable-mode detail page (replacing Phase 5's disabled button, with external/none/malformed modes byte-identical) and independently verified to work standalone with zero props; and no transport detail (`fetch`/`EventSource`/`{@html}`) exists anywhere in `src/lib/components` or `src/routes`. All 48 automated tests pass, `vite build` succeeds, and the human browser checkpoint was completed and approved. `COVERAGE.md` correctly declares no external API integration. No requirement IDs were dropped — Phase 6 has none assigned, confirmed against `REQUIREMENTS.md`'s absence of any Phase 5/6 rows. Three non-blocking code-review warnings (unmount-during-submit-delay race, no submitJob error handling, unvalidated external href scheme) remain unfixed but were explicitly triaged as acceptable for this mock-only phase in `06-REVIEW.md`.

---

*Verified: 2026-08-19T13:11:32Z*
*Verifier: Claude (gsd-verifier)*
