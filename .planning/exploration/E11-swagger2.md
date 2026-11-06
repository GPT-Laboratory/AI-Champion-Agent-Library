# E11: Swagger 2.0, OAuth2 and OpenAPI 3.1/3.2 audit for the Phase 14 generator (decided by Ville, 2026-10-14)

Branch: worktree-agent-a2492381794217162 (based on autonomous/overnight-improvements, nothing pushed). Decisions D-520, D-521, D-522, D-530, D-531, D-532 in `.planning/AUTONOMOUS-DECISIONS.md`. No new dependencies, no network, generated Python only syntax-checked with `py_compile`.

## What was built

| Area | Where | Tests |
| --- | --- | --- |
| Swagger 2.0 normalisation | `src/lib/mcpgen/adapters/openapi-swagger2.ts`, `parseDoc` in `openapi.ts` | `openapi.swagger2.test.ts` (new) |
| OAuth2 / OpenID Connect as a bearer access token | `openapi.ts` (security block), `types.ts`, `plan.ts`, `generate.ts`, `report.ts`, `emit/python.ts` | `openapi.oauth2.test.ts` (new) |
| 3.1/3.2 audit | `openapi.ts` (`note`, `flushAudit`, `deref`, `schemaProps`, `typeOf`, path items) | `openapi.audit31.test.ts` (new) |
| Fixtures | `src/lib/mcpgen/testing/fixtures/acme-swagger2.{yaml,json}`, `acme-oauth2.yaml`, `acme-openapi31.yaml`, `acme-swagger2-hostile.yaml` | used by the tests above |
| Goldens | `src/lib/mcpgen/__golden__/{swagger2-yaml,swagger2-json,oauth2,openapi31}.{model.json,server.py,report.json}` | `openapi.formats.golden.test.ts` (new, includes guarded `py_compile`) |
| Docs | `docs/mcp-generator.md` (adapter text, OAuth2 behaviour, gap table, env var names), one line in `docs/mcp-generator-design.md` | |

## Core and shared files touched (kept minimal)

| File | Change |
| --- | --- |
| `src/lib/mcpgen/types.ts` | `SourceModel.auth.oauth2?: boolean` (one optional field) |
| `src/lib/mcpgen/plan.ts` | exports `OAUTH2_PURPOSE` (one constant) |
| `src/lib/mcpgen/generate.ts`, `report.ts`, `emit/python.ts` | pick the OAuth2 wording for the env var purpose, the header comment and the auth failure message when `auth.oauth2` is set |
| `src/lib/mcpgen/emit/runtime.ts`, registry, `adapters/index.ts` | not touched (the bearer branch already sends `Authorization: Bearer`; the adapter list is unchanged) |

Goldens: no existing golden changed (the OAuth2 flag is absent from every existing model, so the output is byte-identical). The four new golden sets are added in a separate commit.

## Pre-existing tests edited (minimal)

| File | Why it pinned the old behaviour | Edit |
| --- | --- | --- |
| `src/lib/mcpgen/adapters/openapi.test.ts` | detect scored Swagger 2 at 0.1; a Swagger document was rejected as `swagger-2-unsupported` | detect expects 0.95; the empty Swagger 2.0 case expects `no-operations` (nothing usable). Added to EXEMPT in `src/lib/mcptest/criteria.test.ts` with a comment (D-520) |

## Behaviour changes in shared code paths worth knowing

- A `type` list with several non-null types used to pick the first one; it is now `unknown` plus `multi-type-unsupported` (info). No existing fixture hit this.
- A `$ref` that is an anchor (`#Name`) used to say `external-ref-unsupported`; it is now `ref-anchor-unsupported`.
- A path item that is a `$ref` used to be skipped silently; it is now resolved (local) or reported.
- `auth-unsupported` message now names OAuth2 as a supported scheme.

## Known limits

- Swagger 2.0 `basic` security and Swagger path item `$ref` are not supported (basic is reported; see D-522).
- Nested schema keywords are only noticed on schemas the adapter visits (response item schemas and their property schemas).
- `npm run check` includes `criteria.test.ts > every UAT item is unchecked`, which fails on the base commit because `15-HUMAN-UAT.md` (E9) has checked boxes; not part of this work.
