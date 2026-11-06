---
phase: 14-mcp-generator-generalized-from-research-flagged
plan: 03
subsystem: mcpgen
tags: [mcp, generator, openapi, adapter, golden-tests]
requires: [14-01, 14-02]
provides:
  - openApiAdapter (id 'openapi'): OpenAPI 3.x JSON/YAML -> SourceModel
  - invented Acme Parts API fixtures (good and bad) and an end-to-end golden
affects: [14-05, 14-07]
tech-stack:
  added: []
  patterns: [hand-rolled local-$ref schema walker, gaps over guesses, golden through the real registry]
key-files:
  created:
    - src/lib/mcpgen/adapters/openapi.test.ts
    - src/lib/mcpgen/adapters/openapi.golden.test.ts
    - src/lib/mcpgen/testing/fixtures/acme-openapi.yaml
    - src/lib/mcpgen/testing/fixtures/acme-openapi-bad.yaml
    - src/lib/mcpgen/__golden__/openapi.model.json
    - src/lib/mcpgen/__golden__/openapi.server.py
  modified:
    - src/lib/mcpgen/adapters/openapi.ts
key-decisions:
  - D-147 / D-148 / D-149 drafts below (for 14-07 to log)
requirements-completed: [P14-ADAPTER, P14-OPENAPI, P14-BEHAVIOURS, P14-SAFETY]
completed: 2026-10-12
---

# Phase 14 Plan 03: OpenAPI adapter Summary

An OpenAPI 3.x (YAML or JSON) adapter that turns schema into a SourceModel (GET-only, env-var names instead of URLs, clamp limits and nested-collection structure from the schemas), with unit tests, an invented Acme fixture and a byte-stable spec -> model -> server.py golden. Core, registry, adapters/index.ts and emit/* untouched.

## Commits
- 069a150 test: failing tests and invented fixtures (RED)
- 8479fa9 feat: adapter (GREEN)
- ab126b8 test: end-to-end golden

## What it does
- detect: 0.95 for `openapi: 3.x`, 0.1 for Swagger 2 (so parse can explain), 0 otherwise; never throws.
- Server name from info.title; `<NAME>_BASE_URL` (a trailing "API" word is dropped from the prefix); auth from securitySchemes (apiKey header/query -> `<NAME>_API_KEY`, http bearer -> `<NAME>_TOKEN`, others -> gap `auth-unsupported`). servers url, examples and defaults are never read into the model.
- GET operations only; every other method goes to writeOperationsDropped. operationId suffixes like `UsingGET` are stripped; missing ids are synthesised from method and path.
- Kinds: trailing path param -> get, free-text query param -> search, else list. page/size paging from parameter names; `limits.maxPageSize` is the smallest `maximum` seen on page-size parameters.
- Entities from response schemas (array, single wrapper object with one array of objects, or the object itself; allOf merged). Nested array-of-object properties with key-like and value-like item fields become NestedCollections, so the core emits `filter_part_by_features`.
- Gap codes (operation omitted, others kept): `swagger-2-unsupported`, `external-ref-unsupported`, `ambiguous-oneof`, `missing-response-schema`, `path-param-undocumented`, `pagination-conflict`, plus `ambiguous-response`, `ref-depth-exceeded`, `ref-unresolved`, `no-identifier`, `auth-unsupported`, `parse-failed`, `input-too-large`. Nothing usable left -> `{rejected}` with all severities raised to error.
- Safety: local `#/` refs only (external refs reported, never fetched), ref depth 12, 256 KiB guard, yaml `maxAliasCount: 50`, parse never throws and errors carry no document text, copied descriptions have links and control characters stripped.
- Parse gaps are also stored in `model.gaps` so the generation report shows them.

## Verification
- `npm run check` exit 0 (123 files passed, 1 skipped; 1117 tests).
- Goldens read against the design doc checklist: clamp 50, no write tools, no `UsingGET`, env names only, `X-Acme-Key` from env, no URLs.
- The generated Python was only syntax-checked with py_compile (guarded, skipped without python3); never executed.

## Deviations from Plan
- Export name is `openApiAdapter` (the 14-01 stub's name, kept so adapters/index.ts is untouched); the plan text wrote `openapiAdapter`.
- Env prefix drops a trailing `_api` so the names read `ACME_PARTS_BASE_URL` / `ACME_PARTS_API_KEY`.
- Added `ambiguous-response` (several arrays of objects, none obviously the result list) and `oneof-merged` (info) gaps beyond the six required.
- No STATE.md / ROADMAP.md edits, per the parallel-run instructions.

## Decision drafts for 14-07 (AUTONOMOUS-DECISIONS.md)
- **D-147: OpenAPI 3.x only, local refs only, Swagger 2.0 reported.** Alternatives: bundle/convert Swagger 2, resolve external refs. Why: external refs would need network or file access (forbidden), and a converter is a new dependency; ambiguous input becomes a gap, not a guess. Revert: add a converter step before the adapter and relax the `#/` check in `deref`.
- **D-148: servers url discarded in favour of a `<NAME>_BASE_URL` env var.** Why: the generator reads schema only, never endpoints or credentials, and a baked-in url would leak internal hosts into generated files. Revert: record the first servers url as a comment in the model/README (not as a default value).
- **D-149: hand-rolled schema walker instead of an OpenAPI library.** Why: no new dependencies (yaml already present), the needed subset (local $ref, allOf, discriminated oneOf, array wrappers) is small and fully tested, and no library resolves refs over the network by accident. Revert: swap `openapi.ts` internals for a library; the InputAdapter interface and golden files stay the contract.

## Self-Check: PASSED
Files and commits 069a150, 8479fa9, ab126b8 verified present.
