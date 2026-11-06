---
phase: 24
status: passed
verified: 2026-10-14
---

# Phase 24 Verification

Status is not `passed` because `npm run check` fails: 2 tests fail, both caused by the new mcp-server entries (blocker B-004).

## npm run check

- tsc --noEmit: clean (vitest ran).
- vitest: Test Files 2 failed | 269 passed | 1 skipped (272); Tests 2 failed | 3097 passed | 1 skipped (3100).
- Failing: `scripts/ingest.kinds.test.ts` ("real data/agents: base columns equal flag-off, all kind agent") and `scripts/ingest.allformats.hinted.test.ts` ("flag on with legacy-only data: base agents rows equal the flag-off golden rows"). Both assert flag-on == flag-off for data/agents; the three new directories add stk-mcp, stk-catalog-mcp, lvi-info-mcp when the flag is on. The tests were not loosened.
- Before the 24-03 entries were added, the only failure was a docs wording guard (fixed in 24-01); after 24-03 only the two above fail.

## Done-when checks

| Criterion | Result | Evidence |
| --- | --- | --- |
| Inventory lists the 12 agents with status and evidence | pass | docs/consortium-agents-inventory.md: 12 rows, 0 full, 2 partial, 10 missing |
| Template documented and validated | pass | docs/agent-entry-template.md, docs/templates/agent-entry.template.yaml, `npm run validate-entries` exit 0 on template and data/agents (9 skipped); scripts/validate-entries.test.ts 19 passed |
| MCP-server entries validated by the CLI | pass | validate-submission: three entries catalog-manifest / mcp-server / ingestible |
| Flag-on ingest produces them, flag-off unchanged | pass | scripts/mcp-server-entries.test.ts 8 passed (flag off: 9 legacy agents, three slugs absent) |
| DDC MIT attribution recorded | pass | docs/third-party-notices.md (LICENSE and NOTICE.md re-read live 2026-10-14) |
| Gaps list exists | pass | docs/consortium-agents-gaps.md G-001..G-008 |
| npm run check passes | FAIL | 2 failing golden tests, see above |

## Confidentiality and data

- `git grep -il slide` over docs/data/scripts/src/lib/spec: only the three docs with the confidentiality statements.
- No workbook, key, .env value or product row copied; env names only with "<set locally>".

## Environment notes

Worktree needed node_modules (hard-linked copy; a symlink broke vite fs access) and a local `db:push` plus `ingest` (db/ is gitignored); without them 49 test files failed for environment reasons.

## Orchestrator follow-up (2026-10-14)
B-004 resolved: the two golden ingest tests (`scripts/ingest.kinds.test.ts`, `scripts/ingest.allformats.hinted.test.ts`) now expect the three mcp-server entries when the flag is on (flag-off golden untouched). `npm run check`: 271 files passed (1 skipped), 3099 tests passed (1 skipped), tsc clean.
Release note for Phase 30: with AGENT_KINDS off (release default) the mcp-server entries are not listed in the catalog.
