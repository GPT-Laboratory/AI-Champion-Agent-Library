# E13: OData metadata adapter (CSDL JSON and EDMX XML)

Decided by Ville on 2026-10-14 (research: `.planning/phases/14-mcp-generator-generalized-from-research-flagged/14-INPUT-KINDS-RESEARCH.md` sections 2, 3.2, 4, 5 "Adapter B", 6, 7, 9, 10). Decisions D-560..D-572 in `.planning/AUTONOMOUS-DECISIONS.md`. Branch: worktree branch, never pushed.

## What was built

1. New adapter `odata` (`adapters/odata.ts`, readers in `odata-csdl.ts`, XML in `odata-xml.ts`), registered last in `adapters/index.ts`. CSDL JSON and EDMX XML (4.0, 4.01) are read into one intermediate form and then into the `http` backend: a `list_*` tool per entity set (`$top`/`$skip`), a `lookup_*_by_*` tool when the key is usable (single and composite keys), typed `$filter` (equals, contains, startsWith), `$select` from the 12-field projection, no `$expand`.
2. Small core change exactly as the research proposed (D-562): `Param.wireName`, `Operation.protocol`, `Field.odata`, optional `InputAdapter.prepare`. New emitter module `emit/odata.ts` and runtime block `RUNTIME_ODATA`; `plan.ts` gets one branch for `protocol === 'odata'`; `runtimeHttp` gets an `odata` flag that swaps only the request-building lines. REST goldens are byte-identical (verified: the whole mcpgen suite passed unchanged after the core commit).
3. One XML dependency (D-560): `sax@1.6.1`, dynamic import, pre-check, caps (see decision text for the comparison and `docs/dependency-health.md`). `npm audit` before and after: 9 findings (3 low, 6 moderate, 0 high), same packages.
4. Entry points: `runPipelineAsync` and `prepareInput` (D-568); the CLI and the API route use them.

## Pre-existing files edited (minimal)

| File | Change | Why |
| --- | --- | --- |
| `src/lib/mcpgen/registry.test.ts` | the adapter id list gains `odata` | a new adapter is registered (D-561) |
| `src/lib/mcpgen/criteria.test.ts` | the registered adapter id list gains `odata`; the fixture host check skips the two standard namespace hosts (`docs.oasis-open.org`, `schemas.microsoft.com`) | an EDMX document must declare its standard XML namespace URI; these identify a format and are never fetched, and no other host is allowed |
| `src/lib/mcptest/criteria.test.ts` | nothing to add: both files above are already in EXEMPT (E12) | the Phase 15 "no pre-existing test modified" guard |
| `src/lib/mcpgen/registry.ts` | new `prepareInput` | async preparation for adapters that load a parser lazily |
| `src/lib/mcpgen/pipeline.ts` | new `runPipelineAsync` | same |
| `src/routes/api/mcp-generate/+server.ts`, `scripts/generate-mcp.ts` | call the async pipeline; the CLI usage string lists `odata` | EDMX needs the lazy load |
| `src/lib/mcpgen/types.ts`, `plan.ts`, `emit/python.ts`, `emit/pytest.ts`, `emit/runtime.ts` | the core change above | D-562 |

`generate.ts` and `bundle.ts` are untouched (another agent works on them).

## Findings worth knowing

- The core cannot call a dynamically imported module from a synchronous `parse`. Instead of making the whole pipeline asynchronous, the adapter has an optional async `prepare` and the entry points await it first. A caller that forgets gets a clear rejection (`odata-xml-unavailable`), not a crash. `generatorSubject` and `generatorChecks` (Phase 15 in-process generation) still call the synchronous `runPipeline`; they never see EDMX because their inputs are the fixed Acme specs. If a tester case ever feeds EDMX it must use `runPipelineAsync`.
- The Generate MCP panel imports the registry client-side, so `odata.ts` is part of that bundle, but the XML package is only a dynamic import (a separate lazy chunk that the panel never loads: the panel only lists adapters).
- sax (strict mode) accepts a duplicated attribute (`<a x="1" x="2"/>`) and keeps the last one. This is harmless here (the reader only picks known attribute names) and is documented rather than patched.
- Generated Python was never run. Correctness of the literal helpers rests on review, the generated pytest (which ships with the package and asserts the exact `$filter` and key path strings against a stubbed `_raw_get`) and `py_compile` of both files. A person with Python and fastmcp should run `pytest test_server.py` on a generated Acme package once.
- Filtering is case-sensitive (OData `eq`, `contains`, `startswith` are case-sensitive on most services; the sql and dataset tools are case-insensitive). The tool description says so.
- Unbound functions are reported, not called, even parameterless ones: a function call is a different request shape (`/Fn()`), the metadata does not say it is side-effect free (`IsComposable` and `Core.OperationAvailable` do not), and the research listed them as a later phase.
- sax is lenient about a few things XML forbids; the pre-check and caps are the real defence, not the parser.

## Real metadata sizes (input cap question)

`MAX_INPUT_BYTES` stays 262,144 (D-570). Real `$metadata` documents are usually much larger than this: a small business service (20 to 50 entity types) is 100 to 400 kB, large ERP-style or product-data services with hundreds of types and vocabulary annotations are 1 to 10 MB or more. Such documents are rejected with `input-too-large`. Options if Ville wants them: raise the cap for this adapter only (the registry applies one cap before the adapter is chosen, so that needs a per-adapter limit in the core and a larger raw-body cap in the route; the XML limits here (1,000,000 characters, 20,000 elements) were sized for roughly 1 MB), or add a "slice" helper that keeps chosen entity sets. Neither is built. The generator also caps entity types (500), sets (100) and properties per entity (200) because the generated server and its tests grow with them.

## Tests

`emit/odata.test.ts` (core, hand-built model), `adapters/odata.test.ts` (42: both formats, composite keys, enums, navigation, restrictions, V3 rejection, edge cases, hostile DOCTYPE, credentials in annotations), `adapters/odata.golden.test.ts` (model, server.py, test_server.py, report for XML and JSON, py_compile, determinism), `adapters/odata.adversarial.test.ts` (DOCTYPE and entity shapes, billion laughs, quadratic blowup, 10,000-deep nesting, huge attribute, element and attribute caps, linear-time guard on the XML reader and the pre-check, wide schema, hostile names, prototype keys, type cycles, dynamic-import guard). Fixtures: `testing/fixtures/acme-odata.xml`, `acme-odata.json`, `acme-odata-v3.xml`, `acme-odata-doctype.xml`.
