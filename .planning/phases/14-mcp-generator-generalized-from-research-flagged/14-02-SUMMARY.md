---
phase: 14-mcp-generator-generalized-from-research-flagged
plan: 02
subsystem: mcpgen
tags: [mcp, generator, fastmcp, python, golden-tests]
requires: [14-01]
provides:
  - buildPlan / detectDerivedTools (SourceModel to ServerPlan, DerivedTool extension point)
  - generate() producing server.py, test_server.py, requirements.txt, README.generated.md, report.json
  - synthetic Acme sample models (http, dataset, sql) for later plans
affects: [14-03, 14-04, 14-05, 14-06, 14-07]
tech-stack:
  added: []
  patterns: [fixed embedded Python runtime text, golden files, guarded py_compile]
key-files:
  created:
    - src/lib/mcpgen/plan.ts
    - src/lib/mcpgen/generate.ts
    - src/lib/mcpgen/report.ts
    - src/lib/mcpgen/emit/runtime.ts
    - src/lib/mcpgen/emit/python.ts
    - src/lib/mcpgen/emit/pytest.ts
    - src/lib/mcpgen/emit/requirements.ts
    - src/lib/mcpgen/emit/pyutil.ts
    - src/lib/mcpgen/testing/sample-models.ts
    - src/lib/mcpgen/__golden__/ (5 files)
  modified:
    - .planning/AUTONOMOUS-DECISIONS.md
key-decisions:
  - "D-143 write opt-in recorded, not emitted"
  - "D-144 projection cap 12 at plan and runtime"
  - "D-145 stdlib-only backends, tools registered with mcp.tool(fn)"
  - "D-146 golden files plus guarded py_compile"
requirements-completed: [P14-EMITTER, P14-BEHAVIOURS, P14-EXTENSION, P14-SAFETY]
duration: n/a
completed: 2026-10-12
---

# Phase 14 Plan 02: Core emitter Summary

Deterministic SourceModel to Python FastMCP stdio server generator with task-named tools, a structurally detected in-memory filter tool, fixed runtime helpers for checklist rows 1-9, generated pytest, report and golden files.

## What was built

- **plan.ts**: `buildPlan(model, options, extraDerived?)`. Task-oriented names (`list_*`, `search_*`, `lookup_<entity>_by_<id>`, `filter_<entity>_by_<field>`, `query_*`, `describe_<server>`), collision suffixes, 48 char cap, projection cap 12, `detectDerivedTools` (nested key/value array with no request param covering it), user-origin DerivedTools validated (bad ones become `derived-invalid` gaps). Unsafe names, paths and parameter types omit the tool with a gap instead of guessing. Writes are never emitted.
- **emit/runtime.ts + python.ts**: one reviewed block of Python helpers (`_clamp`, `_project`, `_err` with keys ok/kind/message/hint, bounded retry mapping, auth message naming only the env var, honest not-found and empty messages, csv loaded before state assignment, parameterised read-only sqlite). Every tool has `try/except _Fail/except Exception`; no `str(e)`; docstring text is sanitised (no quotes, backslashes, URLs, token-like strings).
- **emit/pytest.ts**: generated tests for behaviours 1-9 against a stubbed upstream (http), temp CSV (dataset) or temp SQLite (sql). Emitted text only.
- **report.ts / generate.ts**: report with dropped writes, gaps, assumptions (FastMCP pin UNVERIFIED), env var table; README with an `.mcp.json` snippet using placeholders only; size cap and no-tools error return no files.
- **Tests**: plan.test.ts (15), generate.test.ts (37), golden.test.ts (4), pycompile.test.ts (python3 found, ran including hostile-text variants).

## Deviations from Plan

**1. [Rule 1 - Bug] Credential assignment emitted as dead code.** Found while reading the first golden file: the auth lines were indented under `if not key: raise`. Fixed in `emit/runtime.ts`, pinned by a string-level assertion in generate.test.ts. Commit d72a2d1.

**2. [Rule 3 - Blocking] Tools registered as `mcp.tool(fn)` instead of the decorator.** The decorator's return type differs between FastMCP versions (UNVERIFIED), which would stop generated tests calling tools directly. Logged under D-145.

**3. Scope notes.** `report.ts` was committed with task 2 (generate() needs it). `test_server.py` is included in `generate()` output (golden file list requires it). Dataset backend emits only the first entity (gap `dataset-multiple-entities`). A derived tool whose name collides gets a numeric suffix.

## Issues Encountered

None blocking. Generated Python was only py_compiled in a temp dir, never run. `npm run check` exit 0 (117 files passed, 1 skipped, 1069 tests).

## Pending human

- Verify the `fastmcp>=3.4,<4` pin and that `mcp.tool(fn)` registers functions in that version.
- Run a generated `test_server.py` in a throwaway virtualenv once (this repo never does).

## Commits

- 106837a feat(14-02): tool synthesis plan and synthetic sample models
- 6de0a06 feat(14-02): Python FastMCP emitter with runtime helpers and generate()
- d72a2d1 feat(14-02): generated pytest, golden files and guarded py_compile

## Self-Check: PASSED

Files and commits above exist; `npm run check` exit 0.
