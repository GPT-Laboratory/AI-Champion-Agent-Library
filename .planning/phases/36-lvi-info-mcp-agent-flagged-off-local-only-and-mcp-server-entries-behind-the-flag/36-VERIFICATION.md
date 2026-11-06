# Phase 36 Verification (in progress: plans 36-01..36-03)

## 36-01 (LMCP-01)
- Flag LOCAL_MCP_AGENTS default off: src/lib/localMcpFlag.test.ts (12 cases).
- Flag-off byte-identical: scripts/flag-off.golden.test.ts and the ingest goldens pass unchanged, no UPDATE_GOLDEN, `git diff scripts/__golden__` empty.
- Relocation: three entries are renames into data/agents-local/; data/agents has only those three removals.
- Ingest second pass and purge: scripts/ingest.local-mcp.test.ts (5), scripts/mcp-server-entries.test.ts retargeted.
- Decisions D-635..D-637 recorded.

## 36-02 (LMCP-02)
- Route 404 when off (no upstream or child process created), 401/403/400/413/429/503/502/504 covered, allow-list, caps, per-lease budget isolation, hook prefix gating both ways.
- `npm run check` (end of 36-02): exit 0; 325 files passed / 1 skipped; 3935 tests passed / 1 skipped.
- Network guard, compose, Containerfile, RunnerConfig unchanged (git diff empty).

## 36-03 (LMCP-03)
- Flag off: buildWarmFiles, buildPiArgs (4 cases) and the staged file set deep-equal the pre-change literals (src/lib/server/tryitout/localMcpStaging.test.ts); existing piRunner/service tests unchanged.
- Flag on, LVI slug: extension staged at AGENT_DIR/extensions/lvi-info.ts, `-e` + 5 tool names in argv, `--no-extensions`/`--no-mcp` kept, no bash; canary env value and `sk-` absent from the staged text.
- Extension behaviour with stubbed fetch: bearer, body, banner, hostile text unchanged inside banner, ok:false/non-2xx throw, budget exhaustion without fetch, missing token without fetch.
- `npm run check`: 328 files passed / 1 skipped; 3957 tests passed / 1 skipped.
- Guard, runnerConfig, compose, Containerfiles, DDC script: git diff empty.

## Cut-off status (Plan 36-04 interrupted)
- Plans 36-01, 36-02, and 36-03 executed, committed, and verified green (npm run check 328 files / 3957 tests pass, 1 skipped).
- Plan 36-04 (LVI-INFO product match agent & live Try It Out run) was interrupted at initialization due to hitting the Anthropic weekly API usage limit (`HTTP 429 You've hit your weekly limit · resets Oct 20, 3am`).
- Plan 36-05 (flagged build/smoke and final closeout) not started.

## Pending when resumed:
1. Plan 36-04: Implement `src/lib/localMcp/mockLviApi.ts`, `data/agents-local/lvi-info-product-match.yaml`, prompts in `data/tryitout-prompts-local/`, tests, and execute one live container run through the proxy.
2. Plan 36-05: Final verification wave across flag states.

