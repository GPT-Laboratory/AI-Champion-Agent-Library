---
phase: 21-generator-stage-0
plan: 03
requirements: [CUST-02]
status: complete
---
# 21-03 Summary: output schemas and structured results

## FastMCP findings (throwaway venvs outside the repo)
fastmcp 3.4.8 (mcp 1.30.0) and fastmcp 4.1.0 (mcp 2.3.0), in-process `fastmcp.Client`.
- `-> dict` alone: both versions advertise only `{"type": "object", "additionalProperties": true}` and return `structured_content` equal to the dict. Too loose.
- `mcp.tool(fn, annotations=..., output_schema=<dict>)`: identical on both. The schema is advertised as given, `structured_content` equals the dict, and a non-conforming result is rejected (3.4.8 `ToolError`, 4.1.0 `RuntimeError`). Error dicts (`ok` false, `kind`, `message`, `hint`) validate.
- Only difference is client-side naming: 4.1.0 renames `Tool.outputSchema` to `output_schema` (old name works with a deprecation warning) and annotation fields to snake_case. The generated tests read the new name first and fall back, so there is no warning on 4.1.0. No version-conditional server code.

## What changed
- `emit/python.ts`: `outputSchemas()` (shapes list / item / describe, derived from tool kind only), `_OUT_*` constants and `_OUTPUT_SCHEMAS` name map in server.py; registration is `mcp.tool(_tool, annotations=_ANNOTATIONS, output_schema=_OUTPUT_SCHEMAS[_tool.__name__])`. Result dict shapes are unchanged. The existing error shape is `ok/kind/message/hint` (the plan mentioned an `error` key; the real shape is kept and is valid under every schema).
- `emit/pytestProposed.ts`: `outputSchemaTests` (schema present, object, `ok` required; structured_content equals the dict and validates with jsonschema, a transitive dependency of fastmcp). `emit/pytest.ts` wires it into every backend (http, odata, dataset, sql); proposal-assisted tests get the schema-presence test only. Annotation test now reads snake_case first (no 4.x deprecation warnings).
- `emit/outputschema.test.ts` (22 tests, committed first, findings in header comment); `annotations.test.ts` registration regex relaxed for the new argument. `docs/mcp-generator.md` has an "Output schemas" section.

## Verification
- `npx tsc --noEmit` clean; `npx vitest run src/lib/mcpgen scripts`: only the 30 known golden byte-equality tests fail (no new ones).
- Beyond the plan: generated acme http, dataset and sql packages written to scratchpad and their pytest run on both venvs: 34, 15, 26 passed on fastmcp 3.4.8 and on 4.1.0, no warnings.
- Not run: proposal-assisted and OData generated packages on real FastMCP (left to 21-05).

## Kept for 21-05
Venvs (with pytest, jsonschema, httpx installed) and generated packages: `/tmp/claude-1000/-home-ville-projects-aic-agent-library/52d45462-8dc8-4ab8-be3d-b4f8a8ec4422/scratchpad/venv-3.4.8`, `.../venv-4.1.0`, `.../gen/{http,dataset,sql}` (generated before the 21-04 changes; regenerate for a final check). Delete after 21-05.

## Golden churn pending (21-05)
Same 30 golden tests as after 21-02; server.py gains `_OUT_*`, `_OUTPUT_SCHEMAS` and the longer registration line, test_server.py gains the schema tests and the snake_case annotation helper.
