---
phase: 13-multi-agent-and-multi-format-hosting-flagged
status: human_needed
verified: 2026-10-12
---

# Phase 13 Verification

Status: automated evidence complete; browser checks are pending human (`13-HUMAN-UAT.md`). Nothing below was verified in a browser.

`npm run check` exit 0 (109 test files passed, 1 skipped). Note: `src/routes/api/tryitout/jobs/jobs.test.ts` ("returns 409 for a failed job", 3 s internal wait) failed once during a loaded run and passed on 3 of 3 reruns and in the following full run; it is a pre-existing timing flake in a file Phase 13 did not touch (also noted in 13-04 and 13-07 under heavy machine load).

## Roadmap success criteria

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Flag off: behaviour, schema output and existing tests unchanged; DB changes additive | Met (automated) | `scripts/flag-off.golden.test.ts` (golden captured before any change, `scripts/__golden__/flag-off.json`); `scripts/flag-regression.test.ts` runs with flag unset, `0` and `off`: golden ingest rows and `PRAGMA table_info(agents)` equal, `agent_kinds` never created, Swarm yaml still rejected, search text and hashes equal, drizzle `agents` columns equal, `detectFormat` still throws "Unrecognized". Load key sets flag off: `src/routes/agents/detail.kinds.test.ts`, `src/routes/catalog/catalog.kinds.test.ts`. Existing tests unmodified (below). Additive DB: only `agent_kinds` (D-033). |
| 2 | Flag on: fixtures in each target format ingest with kind and members/topology | Met (automated) | `scripts/ingest.allformats.test.ts`: 13 fixture folders to 13 `agents` + 13 `agent_kinds` rows, table-driven kind/framework/topology/member counts, idempotent re-run, slug collision reported as failed, no `sk-` strings and extras <= 16 KiB; flag on with legacy-only data equals golden rows. Manual smoke: `AGENT_KINDS=on npm run ingest` on a throwaway copy of the DB and a temp copy of `fixtures/submissions`: "13 succeeded, 0 failed", repeated run identical (`./db/catalog.db` untouched). |
| 3 | `validate-submission` reports ingestible/partial/missing-from-author, never throws | Met (automated) | `scripts/validate-submission.test.ts` (29 tests incl. hostile inputs, spawned CLI). Manual: `npm run validate-submission -- fixtures/submissions` printed "13 submission(s): 7 ingestible, 6 partial, 0 missing-from-author". |
| 4 | Detail page renders members and topology for systems | Met in jsdom/axe only; browser PENDING HUMAN | `src/lib/components/a11y.pages.kinds.test.ts`, `KindBadge.a11y.test.ts`, `SystemMembers.a11y.test.ts`, `src/lib/components/customization.systems.kinds.test.ts`. Browser check: `13-HUMAN-UAT.md`. |
| 5 | Each adapter documents assumptions; unknown fields preserved | Met | `docs/phase13-adapters.md` (per-adapter assumptions and unknown-field behaviour), adapter header comments, per-format tests assert unknown keys land in `extras`. |

Also: flag-on loader tested directly against a real sqlite file and real ingest (`src/lib/server/search/loader.flagon.test.ts`); catalog UI flag-on in `catalog.kinds.test.ts` and `*.kinds.a11y.test.ts` (catalog browser check pending human).

## Guardrails

- Existing tests unmodified: `git diff --name-status <parent of 94cdd59 "docs(13): auto-generated context">..HEAD -- '*.test.ts'` shows 31 entries, all `A` (added); zero `M`/`D`. The golden JSON is also an addition (13-01).
- No new dependencies (`package.json` only gained the `validate-submission` script). Fixtures are synthetic. No model downloads (`SEARCH_EMBEDDINGS=off`, embedder `null` or fake in tests).
- Flag off byte-identical: see criterion 1. The two 13-09 production edits are inert with the flag off (the Customization panel arrays pass through when `kindInfo` is absent; `redactSecrets` is only used on flag-on paths and validator output).

## Decisions

All Phase 13 data-model decisions have revert steps in `.planning/AUTONOMOUS-DECISIONS.md`: D-033, D-034, D-035, D-036, D-037 (13-01/02), D-038, D-039, D-040 (13-03), D-050, D-051 (13-06), D-060..D-062 (13-04), D-070..D-073 (13-05), D-080, D-081 (13-07), D-090 (13-08), D-100..D-102 (13-09). Matched by title and content, not by the nominal numbers in the plan (the plan's D-041+ were already allocated per sub-plan).

## Known gaps

| Gap (source) | Disposition |
| --- | --- |
| Customization panel still listed LLM for systems (13-06) | Fixed in 13-09 (D-101), test `customization.systems.kinds.test.ts`. |
| Flag-on loader path untested directly (13-03/13-07) | Added `loader.flagon.test.ts` (real db, real ingest, singleton loader). |
| Extras redaction ownership unchecked (13-03) | Test added; it found inline `sk-` tokens inside longer strings were stored. Fixed (D-100); adapters and ingest both redact. |
| Browser rendering of system detail, catalog badge and Type filter | PENDING HUMAN (`13-HUMAN-UAT.md`). |
| With the flag on, `data/agents/fixtures/minimal-agent` is added to the catalog (D-039) | Accepted, recorded; question for Ville. |
| `?kind=agent` matches only agents with a sidecar row (D-080) | Accepted limitation. |
| Unverified offline facts: AgentSpec `relationships`/`$component_ref`, CrewAI YAML process default, MCP registry schema churn | Documented in adapter headers and `docs/phase13-adapters.md`; kept opaque in `extras`; re-check before relying on them. |
| Slug collisions from different formats are first-wins, second reported failed (D-039) | Tested; no merge logic. |
| Secret scan is key-name and `sk-` pattern based only; other token shapes (e.g. `ghp_`, AWS keys) under non-denylisted keys are not detected | Not fixed (scope); flag for follow-up. |
| Edges/handoff graph, adapters rank 7+, AutoGen, Try It Out for systems | Deferred by design. |
| Pre-existing svelte warnings (`state_referenced_locally`, tabindex) | Untouched, out of scope. |
