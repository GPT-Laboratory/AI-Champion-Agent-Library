---
phase: 14-mcp-generator-generalized-from-research-flagged
plan: 05
subsystem: mcpgen
tags: [pipeline, cli, api, zip, safety]
requires: ["14-02", "14-03", "14-04"]
provides: [runPipeline, toZip, generate-mcp CLI, POST /api/mcp-generate]
affects: [14-06, 14-07]
key-files:
  created:
    - src/lib/mcpgen/pipeline.ts
    - src/lib/mcpgen/bundle.ts
    - scripts/generate-mcp.ts
    - src/routes/api/mcp-generate/+server.ts
    - tests for each of the above
  modified: [package.json]
metrics:
  completed: 2026-10-12
---

# Phase 14 Plan 05: Entry points Summary

Library pipeline (scan, parse, generate), deterministic fflate zip bundle, an author CLI and a flag-gated POST route returning the package as a zip; nothing is persisted, echoed or logged.

## Commits
- 0bc7f2c: runPipeline and toZip (task 1)
- task 2 commit: CLI, route, tests, `generate-mcp` npm script (see git log on this branch)

## What was built
- `runPipeline(raw, {adapterId?, options?, filename?})` never throws; returns `{ok:true, files, report, serverName, adapterId}` or `{ok:false, gaps}`. 'auto' means detect. Wrong forced adapter is rejected, no fallback. Exceptions become gap `pipeline-failed` with no detail.
- `toZip(files, serverName)`: sorted entries, fixed 1980-01-01 mtime, level 6, path validation (`BundleError`), 2,000,000 byte cap, folder `<server>/`.
- CLI `npm run generate-mcp -- --adapter <id|auto> <input> --out <dir> [--force] [--server-name] [--max-page-size] [--result-ceiling]`. `main(argv, io)` exported. Exit 0 ok, 2 rejected/failed, 64 usage. Reads only the given input file; refuses `.env*` names, files over MAX_INPUT_BYTES, non-empty out dir without `--force`. The io object gained `fileSize` and `readdir` beyond the planned five members (needed for the size and overwrite checks).
- Route: `mcpGeneratorEnabled()` is the first statement, `error(404)` otherwise. 413 / 400 / 422 as specified; options sanitized and clamped; response headers include `x-mcp-gaps`.

## Deviations from Plan
None of substance. Minor: `serverName` and `adapterId` added to the pipeline success result (needed for the zip folder and CLI output).

## Verification
`npm run check` exit 0 (130 files passed, 1 skipped; 1185 tests). Grep confirms no `console.` in mcpgen or the route.

## Decision drafts (for 14-07 to log)
- D-153: Pipeline and CLI ignore the MCP_GENERATOR flag, like validate-submission (author tool; only the web route is gated). Alternative: gate the CLI too. Revert: add a `mcpGeneratorEnabled()` check at the top of `main`.
- D-154: The route returns application/zip rather than JSON file contents, so the author downloads and runs the package (RESEARCH-SYNTHESIS 6 Q1); failures are JSON gaps. Revert: return `{files, report}` JSON from the route, drop `toZip` use.
- D-155: Size caps: input 262144 bytes (413), request body hard cap 2x that before parsing, output 2,000,000 bytes (gap `output-too-large`), CLI refuses oversized input files before reading. Revert: change constants in `api-contract.ts`.

## Self-Check: PASSED
Files exist, commit 0bc7f2c present, check green.
