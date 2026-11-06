# Deferred Items — Phase 07

Out-of-scope discoveries logged during plan execution, per the executor's scope-boundary rule. Not fixed here.

## 07-01: Pre-existing `npx tsc --noEmit` errors (unrelated to this plan)

Found while running Task 3's `npx tsc --noEmit` acceptance check. All errors are in
`src/routes/catalog/+page.server.ts` and `src/routes/catalog/catalog.test.ts` (missing
`$lib/server/db.js` module resolution, implicit-any params, `PageData` type mismatches)
plus two pre-existing errors in `src/routes/agents/try-it-out.test.ts`. Confirmed
pre-existing by stashing this plan's changes (`git stash -u`) and re-running
`npx tsc --noEmit` — the identical error set appears with none of this plan's files
present. None of the errors reference `tryItOutModel.ts` or `tryItOutModel.test.ts`.

Out of scope for 07-01 (Model Probe and Constants Freeze) — left for whichever phase
next touches `src/routes/catalog/`.

## 07-01: Pre-existing `npm test` failure: `scripts/ingest.test.ts` (unrelated to this plan)

`npm test` shows 6 failing tests in `scripts/ingest.test.ts`, all with
`TypeError: Cannot open database because the directory does not exist` at
`new Database(TEST_DB)` — a missing `db/` (or equivalent tmp) directory in this
worktree's checkout, not something this plan's task touched. Confirmed
pre-existing: `git stash -u` (removing all of this plan's new/modified files)
then `npx vitest run scripts/ingest.test.ts` reproduces the identical 6
failures. All other 104 tests (11 of 12 test files, including the new
`src/lib/server/tryItOutModel.test.ts`) pass.

Out of scope for 07-01 — pre-existing environment/fixture issue in the ingest
test suite, unrelated to `tryItOutModel.ts`/`probe-openai-model.ts`.

## 07-02: pre-existing `@testing-library/svelte` module resolution failure

- **Found during:** Plan 07-02, full-suite `npm test` verification step (unrelated to this plan's Task 1/Task 2 files).
- **Symptom:** 6 test files fail with `Error: Cannot find module '/@fs/.../node_modules/@testing-library/svelte/src/vitest.js'` — `src/lib/tryItOut.test.ts`, `src/lib/components/TryItOutPanel.test.ts`, `src/routes/agents/try-it-out.test.ts`, `src/lib/components/FilterBar.test.ts`, `src/lib/components/TechAccordion.test.ts`, `src/lib/components/CustomizationPanel.test.ts`.
- **Root cause:** `node_modules/@testing-library/` is entirely absent in this worktree's `node_modules`, even though `@testing-library/svelte` and `@testing-library/jest-dom` are listed in `package.json` devDependencies. Confirmed with `ls node_modules/@testing-library/` (no such directory). Pre-existing environment/install issue in this worktree, not caused by any file this plan touches (`data/agents/demo-rfi-triage.yaml`, `data/tryitout-prompts/demo-rfi-triage/*`, `scripts/set-try-it-out-mode.ts`, `scripts/set-try-it-out-mode.test.ts`, `.gitignore`).
- **Scope:** Out of scope for 07-02 — none of the failing test files are in this plan's `files_modified` list, and this plan's own new test (`scripts/set-try-it-out-mode.test.ts`) passes cleanly (4/4) along with all 48 other passing tests across the suite.
- **Action taken:** None — not fixed, not re-installed. Flagging for the orchestrator/next plan to run `npm install` (or otherwise reconcile this worktree's `node_modules`) before relying on the full Svelte-component test suite. **Relevant to Wave 3/4 (07-04, 07-05):** those plans touch `TryItOutPanel.test.ts`/`tryItOut.test.ts` directly — verify `node_modules/@testing-library/` is present in their worktree before trusting a green full-suite run.

## 07-03: this worktree's `node_modules`/`db/` were entirely absent (fixed, not deferred)

- **Found during:** Plan 07-03 startup, before Task 1.
- **Symptom:** `node_modules/` did not exist at all in this fresh worktree (not just `@testing-library/`, as 07-02 saw — every dependency including `openai` was missing), and `db/catalog.db` did not exist either.
- **Action taken (per this executor's explicit instructions, not a deferred item):** Ran `npm install` (235 packages), then `mkdir db && npx drizzle-kit push` to create the SQLite schema, then `npm run ingest` (8/8 agents succeeded, including `demo-rfi-triage` with a non-empty `system_prompt`). This unblocked `tryItOutPrompts.test.ts`'s DB-backed cases. Confirms 07-02's flagged concern was correct — every fresh worktree in this phase needs this bootstrap.

## 07-03: pre-existing `npx tsc --noEmit` errors — narrowed, root cause fixed, remainder still unrelated

- **Found during:** Task 3's `npx tsc --noEmit` acceptance check (`grep`-style "no new errors" requirement).
- **Root cause identified and fixed (see 07-03-SUMMARY.md Deviations):** the repo's root `tsconfig.json` `include` array was silently overriding (not merging with) `.svelte-kit/tsconfig.json`'s `include`, dropping `ambient.d.ts`/`non-ambient.d.ts` from the compiled program — so `$env/dynamic/private` and (combined with an unresolved `baseUrl`/`paths` interaction) even ordinary `$lib/*` imports in plain `.ts` files were invisible to bare `tsc`, despite resolving fine under the SvelteKit Vite plugin at dev/test time. Fixed by adding the two ambient files to `include` and restating the `$lib`/`$lib/*` paths mapping relative to this config's own `baseUrl`.
- **Effect:** repo-wide `tsc` error count dropped from 38 to 22 (net: fixed 16, no new errors introduced, all 3 of this plan's new files are error-free).
- **Remaining 22 errors are pre-existing and unrelated to any file this plan touches:** `src/lib/tryItOut.test.ts` (2 unused `@ts-expect-error` directives), `src/routes/agents/detail.test.ts` (1 mock-type-narrowing error), `src/routes/agents/try-it-out.test.ts` (2 `PageData` type errors), `src/routes/catalog/catalog.test.ts` (17 `PageData`-shape errors). Same files 07-01 already flagged as pre-existing/out-of-scope, now surfaced with clearer messages once `$lib` resolution itself stopped masking them. Left for whichever future plan next touches `src/routes/catalog/` or `src/routes/agents/*.test.ts`.

## 07-04: same 22 pre-existing `npx tsc --noEmit` errors, unchanged

- **Found during:** Task 3's `npx tsc --noEmit` acceptance check, re-run after all three of this plan's tasks.
- **Confirmed:** identical 22-error baseline from 07-03 (same files, same line-level errors), just relocated within `src/lib/tryItOut.test.ts` (2 unused `@ts-expect-error` directives, now at lines 223/225 after this plan's full rewrite of that file — the directives themselves are copied verbatim from the pre-existing file, not introduced by this plan). Zero new errors in any of this plan's five touched/created files (`src/routes/api/tryitout/jobs/+server.ts`, `.../[id]/+server.ts`, `.../[id]/artifact/+server.ts`, `.../jobs.test.ts`, `src/lib/tryItOut.ts`, `src/lib/testing/fakeJobApi.ts`, `src/lib/components/TryItOutPanel.test.ts`).
- **Action taken:** None — out of scope per the established phase convention (07-01/07-03). Left for whichever future plan next touches `src/routes/catalog/` or `src/routes/agents/*.test.ts`.
