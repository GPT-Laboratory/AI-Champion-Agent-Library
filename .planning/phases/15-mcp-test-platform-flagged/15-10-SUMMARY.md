---
phase: 15-mcp-test-platform-flagged
plan: 10
subsystem: mcptest-cli-driver
tags: [mcp, cli, container-driver, containerfile]
requires: [15-02, 15-08, 15-09]
provides:
  - scripts/mcp-test.ts (runCli, cmdSubject, splitCommand) and npm script mcp-test
  - src/lib/mcptest/driverRequest.ts (DriverRequestSchema, DriverRequest, DRIVER_REQUEST_MAX_BYTES, DRIVER_PKG_ROOT, KNOWN_CASE_IDS) shared with 15-11
  - src/lib/mcptest/driver.ts (runDriver, main)
  - Containerfile.mcp-test-runner (definition only, never built)
affects: [15-11, 15-12, 15-13]
key-files:
  created:
    - scripts/mcp-test.ts
    - scripts/mcp-test.test.ts
    - src/lib/mcptest/driverRequest.ts
    - src/lib/mcptest/driverRequest.test.ts
    - src/lib/mcptest/driver.ts
    - src/lib/mcptest/driver.test.ts
    - Containerfile.mcp-test-runner
    - src/lib/mcptest/containerfile.test.ts
  modified:
    - package.json (one script line)
requirements-completed: [SC-4, SC-5, SC-6]
completed: 2026-10-13
---

# Phase 15 Plan 10: CLI, in-container driver and runner image Summary

`npm run mcp-test` runs the suite over fake, generator or `cmd:` subjects (real servers only with `--allow-local-exec`), an in-container driver runs the same runner from a validated `request.json`, and the runner image is defined but never built.

## Commits (branch worktree-agent-aa3e970d80e5b1c4d)
- 610d2b6 driver and shared DriverRequest schema (11 tests incl. schema)
- 95fd946 CLI and npm script (13 tests)
- f62ab45 Containerfile and static test (7 tests)

## Behaviour
- CLI: `--subject fake:<v>|generator:<s>|cmd:"<cmd>"`, repeatable `--case`, `--reruns 1-3`, `--format text|markdown|json`, `--out`, `--list`, `--allow-local-exec`, `--env-base-url`, `--env-api-key`. Exit 0 only for verdict PASS, 1 otherwise, 2 usage. Any argument (also inside a `cmd:` command) whose basename starts with `.env` is refused. `--out` is schema-validated, must not be an existing directory; nothing else is written. MCP_TESTER is never consulted. No `process.env` use in the file (asserted).
- `cmd:` without `--allow-local-exec`: cells PENDING_HUMAN (runner stdio guard), exit 1, prints `npm run mcp-test -- --subject cmd:"..." ... --allow-local-exec` (quotes escaped). With it: spawn through 15-02 `spawnStdioChannel` (no shell, scrubbed env); runtime label `local-cli`.
- Driver: size-capped read of `<in>/request.json`, strict zod validation, `runSuite` with `runtime: 'container'`, `allowStdioExec: true`, writes `<out>/report.json`; invalid request gives `error.json` and return 1, no report. Only reads MCPTEST_IN, MCPTEST_OUT, MCPTEST_PKG_ROOT (asserted by a source test). Staged cwd `/work/pkg/...` is re-rooted under `pkgRoot`.
- Containerfile: Node 22.19 bookworm-slim, python3/pip/venv, yaml/zod/fflate/tsx at package.json versions under `/node_modules` (installed with `--ignore-scripts`), fastmcp in `/opt/venv` with the UNVERIFIED comment, user `node`, `/work`, `CMD ["sleep","infinity"]`, no EXPOSE/ENTRYPOINT/secrets. Nothing was built or run.

## Interface notes for 15-11 / 15-13
- Import `DriverRequestSchema`, `DriverRequest`, `DRIVER_REQUEST_MAX_BYTES`, `DRIVER_PKG_ROOT` from `src/lib/mcptest/driverRequest`. Case ids are a literal `KNOWN_CASE_IDS` tuple (no static list existed in core); a test pins it to the suite directory, so adding a case requires updating it. Fake `variant` is only shape-checked (`/^[a-z0-9-]{1,40}$/`); unknown variants surface as a GEN_FAILED cell in the report, not as a request error.
- Driver run command inside the container: `tsx /work/src/lib/mcptest/driver.ts` (the staged sources must contain `src/lib/mcptest` and `src/lib/mcpgen`; deps resolve from `/node_modules`). Exit 0 whenever a report was written.
- Staged subject kind is `generator` when the request `id` starts with `generator:`, else `submitted` (so generator-only cases like T4-PARTIAL-SPEC apply correctly).

## Decision drafts (not written to AUTONOMOUS-DECISIONS.md)
- **DRAFT-15-10-a** In-container driver instead of extending ContainerRuntime. Revert: add attach/stdin to the Phase 8 contract and implement a host-side client.
- **DRAFT-15-10-b** CLI ignores MCP_TESTER like generate-mcp (author tool). Revert: gate in `runCli`.
- **DRAFT-15-10-c** Node deps installed under `/node_modules` in the image (ESM resolution walks up from /work; NODE_PATH is ignored by ESM).
- **DRAFT-15-10-d** Python deps in a venv at `/opt/venv` on PATH (bookworm Python is externally managed); extra `pyyaml` beyond the generated requirements. Revert: `--break-system-packages`.
- **DRAFT-15-10-e** `cmd:` subject id is `cmd:<basename of argv0>` and runtime label `local-cli`; generator subjects also use `local-cli`, fakes use `fake`.
- **DRAFT-15-10-f** `KNOWN_CASE_IDS` literal list in driverRequest.ts, pinned by test, keeps the schema pure and synchronous.

## Deviations from Plan
- Tests for good/mirror use `--case T1-STD-CATALOG --case T2-CATALOG-API` for the PASS example: a Tier 1 case alone gives verdict INCOMPLETE (no Tier 2/3 case to score, coverage 0/0), so the plan's single-case example would exit 1.
- The plan's "spy spawner" is replaced by a real spawn of `core/testing/stubServer.mjs` via `node` (the spawn path is inside the runner, not injectable); argv split, no-shell and scrubbed env rest on the 15-02 tests plus a source grep for `shell: true`/`child_process`.
- Not tested: the "oversize report replaced by minimal error report" branch of the driver (the runner already shrinks reports; the driver fallback needs an injectable cap). The branch exists and uses `buildReport`, so it always yields valid JSON.
- Task order: driver (Task 2) was committed before the CLI (Task 1); they are independent.

## Verification
`npx vitest run` of the three new test groups green (31 tests); `npx tsc --noEmit` clean; `npm run check` exit 0 (163 files passed, 1 skipped, 1651 tests). No forbidden tokens in new files; no existing test edited; one package.json script line; no python executed, no image built.

## Self-Check: PASSED
Files exist and commits 610d2b6, 95fd946, f62ab45 are on the worktree branch.
