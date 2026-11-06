# Autonomous run summary (short report, 2026-10-14)

The long per-phase log that used to be here now lives in the phase `*-SUMMARY.md` and `*-VERIFICATION.md` files, the exploration notes and the decisions log. Nothing unique was dropped (checked against the phase files, `AUTONOMOUS-DECISIONS.md`, `docs/` and the HUMAN-UAT files).

## Final status
- Branch `autonomous/overnight-improvements`; all work committed, nothing pushed.
- Phases 1-20 are built and recorded. Phases 16-20 were executed outside the normal GSD flow (no PLAN files by design). Phases 21-23 are planned, not started.
- Phase 2 is the only earlier phase not closed: it needs the human checkpoint 02-04 (D-001).
- `npm run check` twice exit 0: 269 test files passed (1 skipped), 3072 tests passed (1 skipped).
- `SEARCH_EMBEDDINGS=off npx vite build` exit 0. `npm run smoke` 104/104 (8 flag configurations).
- Generated packages' own pytest pass on FastMCP 3.4.8 and 4.1.0 (counts in `phases/18-live-verification-and-container-path-fixes/18-VERIFICATION.md`).
- Not run: OData with filter/split proposal ops; real MCP calls against a live OData service.

## Read first
1. `.planning/STATE.md` (position, Pending on Ville, how to resume)
2. `.planning/ROADMAP.md` (Progress table, Phases 16-23)
3. `.planning/v1.0-MILESTONE-AUDIT.md`
4. `.planning/AUTONOMOUS-DECISIONS.md` (index at the top)
5. `.planning/AUTONOMOUS-BLOCKERS.md`
6. `docs/human-verification-guide.md`

## Phases 16-23
- 16 Review and Hardening Pass (done): reviews and fixes for 13-15, audit fixes, build fix, error states, smoke, perf, dependency health, the seven user decisions (D-460..D-466)
- 17 Optional UI Features (done, flagged): spec viewer, compare, dark mode; browser checks pending
- 18 Live Verification and Container-Path Fixes (done): real-model search run, FastMCP 3.4.8/4.1.0, live Podman run and fixes
- 19 Generator Input Kinds (done): Swagger 2.0, OAuth2, OpenAPI 3.1 audit, SQL dialects, Prisma, OData
- 20 Proposal Layer and Context Pack (done): stages 1-2, no in-platform model calls
- 21 Generator Stage 0 (planned): description cleanup, annotations, outputSchema, deterministic order
- 22 Proposal Layer Follow-ups (planned): first real proposal, baseline vs proposal run, hygiene tuning, OData derived_filter
- 23 Code Review of New Generator Code (planned): review, fixes and security audit of everything since the Phase 14 review

## What needs you
See STATE.md "Pending on Ville": paid-key check 7, Phase 9 check 9 re-run, Phase 15 browser/cancel/auth items and container run, the browser checks in the human guide, Phase 2 checkpoint 02-04, Phase 3 `/catalog` UI checks, and the few still-open questions. Environment: this machine has 3.7 GB RAM; do not run Podman checks next to heavy agents.
