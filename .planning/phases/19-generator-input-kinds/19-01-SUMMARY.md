---
phase: 19-generator-input-kinds
plan: 01
subsystem: mcpgen
tags: [swagger2, oauth2, openapi31, pg_dump, sqlite, mysqldump, prisma, odata, sax, research]
execution: outside-gsd-flow
status: complete
requires: [14, 15]
provides:
  - Swagger 2.0 input, OAuth2 bearer-from-env, OpenAPI 3.1/3.2 audit
  - SQL dialects (pg_dump, SQLite .schema, mysqldump) and a hand-rolled Prisma reader
  - OData adapter (CSDL JSON and EDMX XML) around a hardened sax reader
  - two research docs in the Phase 14 directory
key-files:
  created:
    - .planning/exploration/E11-swagger2.md
    - .planning/exploration/E12-sql-dialects.md
    - .planning/exploration/E13-odata.md
    - .planning/phases/14-mcp-generator-generalized-from-research-flagged/14-INPUT-KINDS-RESEARCH.md
    - .planning/phases/14-mcp-generator-generalized-from-research-flagged/14-NONDETERMINISTIC-GENERATORS-RESEARCH.md
  modified:
    - package.json
decisions: [D-520..D-522, D-530..D-532, D-540..D-549, D-560..D-572]
requirements: [CUST-02]
completed: 2026-10-14
---

# Phase 19: Generator Input Kinds Summary

**Executed outside the normal GSD flow** (inputs decided by Ville, 2026-10-14; directly launched agents in worktrees; notes E11, E12, E13). No PLAN files by design.

**The Phase 14 generator now reads Swagger 2.0, more SQL dialects, Prisma and OData metadata, without changing its core.**

## Accomplishments

- **Swagger 2.0 + OAuth2 + OpenAPI 3.1/3.2 audit (D-520..D-522, D-530..D-532):** Swagger 2.0 (JSON or YAML) is read by the existing `openapi` adapter (id unchanged); OAuth2 as bearer token from an env var (the generator never fetches tokens); 3.1/3.2 constructs are each supported or reported once per document with a stable code and a fixed message that never copies document text.
- **SQL dialects + Prisma (D-540..D-549):** pg_dump (including a key-loss defect where `ALTER TABLE` constraints were dropped, fixed: constraints are folded into the table model), SQLite `.schema`, mysqldump; `COPY` data is never ingested; hand-rolled Prisma reader (no dependency).
- **OData (D-560..D-572):** CSDL JSON and EDMX XML via `sax@1.6.1` (exact pin, the single new dependency), hardened: pre-check rejects DOCTYPE, ENTITY, other `<!` and processing instructions, size/depth caps, dynamic import so flag-off and non-OData paths never load it.
- **Research docs:** `14-INPUT-KINDS-RESEARCH.md` (further deterministic input kinds) and `14-NONDETERMINISTIC-GENERATORS-RESEARCH.md` (LLM-assisted and agentic generators), both in the Phase 14 directory.
- Generated packages' pytest pass on FastMCP 3.4.8 and 4.1.0 (counts in the VERIFICATION file).

## Deviations from the GSD flow

No discuss/plan cycle; the research docs live in the Phase 14 directory because they extend that phase. Phase 19 has no REQ-ID of its own; it extends CUST-02.

## Next

Phase 23 reviews all of this code (not yet reviewed).
