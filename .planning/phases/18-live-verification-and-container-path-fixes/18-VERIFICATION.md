---
phase: 18-live-verification-and-container-path-fixes
status: human_needed
verified: 2026-10-14
execution: outside-gsd-flow
---

# Phase 18 Verification

Status: partly live-verified; the rest is pending human. Executed outside the normal GSD flow.

## Final verified numbers (main, after the last merge, 2026-10-14)

- `npm run check` twice exit 0: 269 test files passed (1 skipped), 3072 tests passed (1 skipped). `SEARCH_EMBEDDINGS=off npx vite build` exit 0. `npm run smoke` 104/104 (8 flag configurations).
- Generated packages' own pytest pass on BOTH FastMCP 3.4.8 and 4.1.0: openapi 23, tabular 11, sql 35, odata-xml 12, odata-json 12, swagger2 23, oauth2 17, openapi31 17, pgdump 35, mysqldump 19, sqlite 27, prisma 27; proposal-assisted packages (Acme OpenAPI and SQL, 5 tests each); OData with proposals (5 each).
- Not run: OData with filter/split proposal ops; real MCP calls against a live OData service.

## Live results

| Item | Status | Evidence |
| --- | --- | --- |
| Real-model search run | Verified live | `03-HUMAN-UAT.md` items 1-2: scale hybrid hit@3 0.88 / hit@1 0.85 / MRR 0.87; real 9 agents hit@3 1.00 / hit@1 0.92 / MRR 0.96; MiniLM kept, SIM_FLOOR 0.25 |
| FastMCP 3.4.8 and 4.1.0 | Verified live | throwaway venvs, D-479 |
| Podman Phase 9 + Phase 15 container checks (E9) | 13 PASS, 3 FAIL, 1 BLOCKED, 5 skipped | `E9-live-podman.md`; check 7 needs a paid key |
| Defects D1, D2, D4 fixed | Verified live | image builds (607 MB, user `pi`), container run of `generator:openapi` done in 37 s |
| Defect D3 fixed (binding file) | Verified live | generate-then-score via CLI: score 26.3, 5 of 19 T2 checks pass (was 0) |
| Defect D5 (UAT wording) | Docs only, not re-verified live | `09-HUMAN-UAT.md` |

## Not verified (pending human)

- `/catalog` search UI, items 3 and 4 of `03-HUMAN-UAT.md`.
- Phase 9 check 7 (paid OpenAI key budget run) and check 9 re-run (compose down); the cancel path; sweep-vs-run-in-flight; browser UI.
- Container run showed 4 PASS and 1 ERROR (`auth_failure` wrong-key relaunch inside the container): not analysed.
- The generated openapi server still fails 14 of 19 T2 checks for real-server reasons (mock route mismatch, missing tools for four roles); this is a generator-quality item, not a container-path defect.
- Steps for all of these: `docs/human-verification-guide.md` section 8.
