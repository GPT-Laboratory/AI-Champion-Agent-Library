# 36-01 Summary: LOCAL_MCP_AGENTS flag, relocation, ingest second pass

## Built
- `src/lib/localMcpFlag.ts` (`localMcpAgentsEnabled`, env LOCAL_MCP_AGENTS, default off), re-exported from `src/lib/flags.ts`; tests in `src/lib/localMcpFlag.test.ts` (written first, seen failing).
- `src/lib/localMcp/slugs.ts`: LOCAL_MCP_SERVER_SLUGS, LVI_AGENT_SLUG, LOCAL_MCP_SLUGS.
- `git mv` of stk-mcp, stk-catalog-mcp, lvi-info-mcp from `data/agents/` to `data/agents-local/` (content untouched).
- `scripts/ingest.ts`: `ingestAll(dataDir, dbPath, {embedder, localDir})` and `purgeLocalSlugs`; main calls `ingestAll`. `ingest`/`ingestInto` untouched. Flag on: second pass over data/agents-local (INGEST_LOCAL_DIR). Flag off: purge of local slugs from agent_kinds, agent_embeddings, agents (each only if the table exists; errors logged via sanitizeMessage, never fatal).
- Tests: `scripts/ingest.local-mcp.test.ts` (5), `scripts/mcp-server-entries.test.ts` retargeted to data/agents-local.
- Docs: `docs/local-mcp-agent.md` skeleton (TODO(36-04) run, TODO(36-05) security), pointers in agent-entry-template.md and phase13-adapters.md.
- Decisions D-635, D-636, D-637 with evidence and revert steps in `.planning/AUTONOMOUS-DECISIONS.md`.

## Verification
- `scripts/flag-off.golden.test.ts`, flag-regression, ingest, ingest.kinds, ingest.fixtures-skip pass with no golden change (`git diff scripts/__golden__` empty). 57 tests across the 7 ingest-related files green.
- criteria.test.ts (Phase 15 guard) green. No `npm run check` here (36-02 end).

## Deviations
None. No other file in the repo referenced the three slugs under data/agents.
