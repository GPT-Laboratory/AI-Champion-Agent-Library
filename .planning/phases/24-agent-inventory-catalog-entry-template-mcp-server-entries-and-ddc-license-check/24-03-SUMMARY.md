---
phase: 24
plan: 03
subsystem: catalog-data
tags: [mcp-server, catalog-manifest, ingest]
requires: [24-01]
provides: [mcp-server-entries]
key-files:
  created:
    - data/agents/stk-mcp/catalog.yaml
    - data/agents/stk-catalog-mcp/catalog.yaml
    - data/agents/lvi-info-mcp/catalog.yaml
    - scripts/mcp-server-entries.test.ts
  modified:
    - docs/consortium-agents-inventory.md
    - docs/consortium-agents-gaps.md
    - .planning/AUTONOMOUS-BLOCKERS.md
decisions:
  - "Catalogued stk-mcp (gsd-only arm), stk-catalog-mcp (codex arm) and the hand-authored arm as lvi-info-mcp; the other five LVI-INFO arms appear only as a variants list (G-005, G-006)"
  - "Entry names are short (STK MCP etc.) because the ingest slug is derived from the name, not the directory"
metrics:
  completed: 2026-10-14
---

# Phase 24 Plan 03: MCP-server entries Summary

Three `kind: mcp-server` manifests validate as catalog-manifest / mcp-server / ingestible. With AGENT_KINDS=on ingest records them in agent_kinds (frameworks fastmcp, json-rpc, fastmcp); with the flag off they are absent and the 9 legacy agents ingest unchanged. Servers were inspected read-only (server.py, pyproject, README); env variable names are recorded with the placeholder value "<set locally>"; no workbook, data or keys were touched or copied (a workbook sits next to the codex server and was left alone).

## Blocker

B-004: two existing golden tests (`scripts/ingest.kinds.test.ts` real data/agents case, `scripts/ingest.allformats.hinted.test.ts` legacy-only golden) assert flag-on equals flag-off for data/agents and now fail because of the three new directories. Not loosened, per the run rules. Recorded in .planning/AUTONOMOUS-BLOCKERS.md and gaps G-008, with two resolution options.

## Deviations

- The repository-wide criteria guard forbids the uppercase source-case token in docs/scripts/src, so docs and the test avoid writing the database acronym in capitals; data/agents is outside that guard and the entries use it.

## Commits

feat(24-03) entries; test(24-03) validator and ingest checks; docs updates in the verification commit.
