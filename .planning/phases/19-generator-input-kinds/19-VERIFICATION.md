---
phase: 19-generator-input-kinds
status: human_needed
verified: 2026-10-14
execution: outside-gsd-flow
---

# Phase 19 Verification

Status: automated evidence complete including real generated-package pytest runs; one live check was not run and the new code has not had a code review yet (Phase 23). Executed outside the normal GSD flow.

## Final verified numbers (main, after the last merge, 2026-10-14)

- `npm run check` twice exit 0: 269 test files passed (1 skipped), 3072 tests passed (1 skipped). `SEARCH_EMBEDDINGS=off npx vite build` exit 0. `npm run smoke` 104/104.
- Generated packages' own pytest on BOTH FastMCP 3.4.8 and 4.1.0: openapi 23, tabular 11, sql 35, odata-xml 12, odata-json 12, swagger2 23, oauth2 17, openapi31 17, pgdump 35, mysqldump 19, sqlite 27, prisma 27.

## Evidence

| Item | Status | Evidence |
| --- | --- | --- |
| Swagger 2.0, OAuth2, 3.1/3.2 audit | Met (automated + pytest) | D-520..D-532, `E11-swagger2.md`, goldens |
| SQL dialects and pg_dump ALTER key-loss fix | Met | D-540..D-549, `E12-sql-dialects.md`, goldens, adversarial and linear-time tests |
| Prisma hand-rolled reader | Met | D-540..D-549 |
| OData CSDL JSON + EDMX XML, hardened sax | Met | D-560..D-572, `E13-odata.md`; adversarial (DOCTYPE/entity/PI/caps) and linear-time tests |
| Research docs | Delivered | two files in the Phase 14 directory |

## Not verified

- Real MCP calls against a live OData service (only generated-package tests with the mock upstream were run).
- OData with `filter`/`split` proposal ops (Phase 20 feature, not run).
- No code review or security audit of the new code: Phase 23 (planned). The sax hardening is test-covered but not independently reviewed.
