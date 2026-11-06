# MCP generator design

Status: design, written before any generator code (Phase 14, plan 14-01).
Feature flag: `MCP_GENERATOR` (default off).
Evidence base: `.planning/phases/14-mcp-generator-generalized-from-research-flagged/RESEARCH-SYNTHESIS.md`, cited below as "synthesis N" with its section number.

## 1. Goals and non-goals

Goals (synthesis 0):

- Turn a source description (an OpenAPI document, tabular column definitions, or SQL DDL) into a small Python FastMCP stdio server package that already implements the behaviours a hand-authored server showed to matter, not just a 1:1 endpoint mirror.
- Be deterministic: the same input yields byte-identical output.
- Report what it dropped, skipped or could not decide, instead of guessing.
- Be extensible: a new input type is one registered adapter.

Non-goals:

- No LLM-assisted generation in this phase (synthesis 5.3, 14-CONTEXT). It stays an optional, clearly marked, off-by-default future layer.
- No execution of generated code by the platform; generated servers are black boxes.
- No ingestion of row data, credentials or real catalogs.
- No hosting of generated servers (see open question 1 in section 9).

## 2. Evidence summary

What the catalog study showed (synthesis 1.3, 1.4):

- A hand-authored server scored 9 of 9 scored checks. Every automated arm scored 6 or less; a deterministic OpenAPI converter scored 4 of 9 (perfect at mirroring endpoints, zero on defensive and synthesized behaviours), a spec-driven LLM arm scored 5, a single-prompt arm 6, an agentic generator 0 to 2 and unstable.
- The winning arm followed five rules: task-named tools, trimmed responses, one synthesized in-memory filter tool that reports coverage, page-size clamping, and structured errors instead of raw upstream envelopes.
- Telling an LLM about these behaviours was not enough (the single-prompt and spec-driven arms still under-implemented them). Emitting them deterministically from templates is the direct fix.

Caveats stated plainly (synthesis 1.2):

- Dimensions D3 (contract fidelity) and D5 (code quality) were never scored anywhere.
- `results.csv` holds the 10-check harness results, not the suite's D1-D6 scores. D6 (process cost) exists for one arm only.
- The study never scored non-OpenAPI inputs (synthesis 0 item 4, section 2). Our tabular and DDL adapters are therefore designed from reasoning, not from measured evidence.

## 3. Input adapters

v1 adapters, all deterministic (synthesis 5.1):

| Adapter id | Input | v1 scope |
|---|---|---|
| `openapi` | Swagger 2.0 and OpenAPI 3.x JSON or YAML (Swagger 2.0 normalised inside the adapter, D-520) | operations, params (min/max/enum), response schemas, security schemes; GET only by default |
| `tabular-catalog` | Header, schema and field-dictionary text (CSV-style header lines, dictionary pairs) | column names, labels, types, identifier columns |
| `sql-ddl` | `CREATE TABLE` statements; pg_dump, SQLite `.schema`, mysqldump dialects (D-540..D-545) | tables, columns, types, PK/FK (also from `ALTER TABLE ... ADD CONSTRAINT`), enums; read-only SELECT tools (roadmap requirement CUST-02) |
| `prisma` | Prisma `schema.prisma` (D-546) | models, scalar fields, `@id`/`@@id`, `@relation`, enums; datasource and generator blocks ignored |
| `odata` | OData `$metadata`: CSDL JSON and EDMX XML, 4.0 and 4.01 (D-561..D-572) | entity sets, keys (also composite), Edm types, enums, typed `$filter`, `$top`/`$skip`, `$select`; GET only; `$expand`, actions, functions and external references reported; XML read by the one dependency `sax` (D-560) |

Tabular input is header, schema or dictionary text only. Data rows are never ingested; only a few synthetic sample rows may appear in tests. This answers synthesis open question 3 (section 6).

Deferred inputs are reported as unsupported, never guessed (synthesis 2, 5.1, 5.4 item 5):

| Deferred input | Reason |
|---|---|
| Docs-only (HTML, PDF, manual) | Needs grounding discipline; hallucination risk is the whole problem |
| Data dump beyond tabular headers | Inference from row data is out of scope and unsafe |
| Profile or standard conformance | Needs the real profile specification |
| Code repository | No evidence, no working arm in the study |
| Composite, cross-source | Designed only in the study |

When nothing detects, the registry returns a gap `unrecognized-input`, not a best guess.

## 4. Core architecture

Pipeline (synthesis 5.2):

    RawInput -> InputAdapter.parse -> SourceModel -> ServerPlan -> Python text (templates)
             -> generated pytest -> GenerationReport

Adapters translate a source into one canonical `SourceModel`; the core never sees the source format. The contract (all defined once in `src/lib/mcpgen/types.ts`):

```typescript
export type Severity = 'error' | 'warn' | 'info'
export interface Gap { code: string; message: string; severity: Severity; path?: string }
export type FieldType = 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object' | 'unknown'
export interface Field { name: string; type: FieldType; label?: string; description?: string; identifier?: boolean; nameLike?: boolean; classLike?: boolean; nullable?: boolean; enum?: string[] }
export interface NestedCollection { field: string; itemFields: Field[]; keyFields: string[]; valueFields: string[] }
export interface Entity { id: string; label: string; fields: Field[]; identifierFields: string[]; nested: NestedCollection[] }
export interface Param { name: string; in: 'query' | 'path' | 'body' | 'column'; type: FieldType; required: boolean; min?: number; max?: number; enum?: string[]; description?: string }
export interface Operation {
  id: string; kind: 'list' | 'get' | 'search' | 'other'; method: 'GET' | 'SELECT' | 'DATASET'
  path?: string; entity: string; params: Param[]; pageParam?: string; pageSizeParam?: string; summary?: string
}
export interface SourceModel {
  name: string
  backend: { kind: 'http' | 'dataset' | 'sql'; baseUrlEnv?: string; datasetPathEnv?: string; dsnEnv?: string }
  auth: { scheme: 'none' | 'apiKeyHeader' | 'apiKeyQuery' | 'bearer'; paramName?: string; envVar?: string } // names only, never values
  entities: Entity[]; operations: Operation[]
  limits: { maxPageSize?: number; resultCeiling?: number; maxResponseItems: number }
  gaps: Gap[]; writeOperationsDropped: string[]
}
export interface GenerateOptions { allowWrite?: string[]; limits?: Partial<SourceModel['limits']>; projectionOverride?: Record<string, string[]>; serverName?: string }
export interface RawInput { text: string; filename?: string }
export type ParseResult = { model: SourceModel; gaps: Gap[] } | { rejected: Gap[] }
export interface InputAdapter { id: string; label: string; detect(input: RawInput): number; parse(input: RawInput, options?: GenerateOptions): ParseResult }
export interface DerivedTool { id: string; kind: 'inMemoryFilter' | 'schemaDiscovery' | 'crossFieldSearch'; entity: string; source: string; description: string; origin: 'detected' | 'user' }
export interface PlannedTool { name: string; description: string; entity: string; operation?: string; derived?: DerivedTool; params: Param[]; projection: string[] }
export interface ServerPlan { model: SourceModel; tools: PlannedTool[]; derived: DerivedTool[]; gaps: Gap[] }
export interface GeneratedFile { path: string; content: string }
export interface GenerationReport { toolsEmitted: string[]; toolsDropped: { id: string; reason: string }[]; gaps: Gap[]; assumptions: string[]; envVars: { name: string; purpose: string }[] }
export interface GenerationResult { files: GeneratedFile[]; report: GenerationReport }
```

OData additions to the contract (D-562): `Param.wireName?` (the name on the wire when it differs from the argument name), `Operation.protocol?: 'rest' | 'odata'` (selects the OData templates; paths are entity set paths), `Field.odata?: { kind, filterable, enumType? }` (literal kind for `$filter`) and the optional `InputAdapter.prepare?()` (async step for a lazily loaded parser). REST output is unchanged.

Invariant: adding an adapter means registering one `InputAdapter` in `src/lib/mcpgen/adapters/index.ts` (the only place adapters are listed). The core, the registry logic and the templates stay unchanged (roadmap success criterion 2).

The registry (`registry.ts`) mirrors the Phase 13 format registry: detect then parse, best confidence first with list order as tie-break, never throws. Order inside `parseInput`: size cap, credential scan, adapter selection, `adapter.parse`.

## 5. Emitter behaviour checklist

The nine behaviours of synthesis 3.2 are the contract. The emitter always produces them from fixed templates; the generated pytest asserts each against a mock.

| # | Behaviour | Emitter rule |
|---|---|---|
| 1 | Task-oriented names and a synthesized filter tool | Name from intent (`lookup_*`, `search_*`, `filter_by_*`, `list_*`), not operation id; add derived filter tools where the structural rule of section 6 fires |
| 2 | Trimmed responses | Default projection per entity (identifier, name-like, class-like, nested data of interest) capped at 12 fields; a `fields` argument widens; raw upstream objects are never forwarded |
| 3 | Page-size clamp | Clamp to `[1, maximum]` taken from the source's documented maximum; state the clamp in the tool description |
| 4 | Ceiling warning | Ceiling comes from `limits.resultCeiling`; when `page * pageSize` would exceed it, return a structured warning suggesting a narrower filter |
| 5 | Honest not-found | 404 or an empty single lookup returns "No <entity> found for <id>" |
| 6 | Honest empty results | A 200 with zero rows returns `results: []` plus a "No matches" message, never a bare empty envelope |
| 7 | Structured errors, no raw envelopes | Catch everything in every tool; map status to a short category message; never echo upstream bodies or exception text |
| 8 | Auth failure as an auth message | 401/403 maps to "Authentication failed: check the API key configured in <ENV_VAR>"; the env var name is shown, never the value |
| 9 | Read-only default | Emit GET/SELECT only; drop POST/PUT/PATCH/DELETE and list them in the report; write tools only with an explicit per-operation opt-in |

Pitfall: the study's leak detector fails any output that contains 3 or more of the words timestamp, status, error and path. Our own error shape therefore uses the keys ok, kind, message and hint (the key set `ok/kind/message/hint`), which contains at most one of those words. Output must also never contain the leak patterns: `Traceback (most recent call last)`, `httpx.`, `all shards failed`, `requests.exceptions`, `ConnectionError`, `JSONDecodeError`.

Also carried over (synthesis 3.2, end): bounded retry with backoff on 429/5xx, malformed upstream JSON becomes an honest tool error, keys never in logs or output, query params validated and escaped, identifier-like codes validated rather than treated as free text.

## 6. Derived-tool extension point

A `DerivedTool` is a tool synthesized for a capability the source lacks (synthesis 3.1, 5.2). Shape: see `DerivedTool` in section 4; `origin` is `detected` (by the structural rule) or `user` (added by the author).

Structural detection rule (domain-free): an entity has a nested array of objects that carry a class-like or id-like key plus value-like fields, and no declared request parameter filters on those fields. The generator then emits `filter_by_<field>`, which:

1. fetches candidate pages itself (a caller-supplied candidate list is never the input),
2. filters the nested array in memory,
3. returns the matching, projected items,
4. reports coverage: pages scanned and a `truncated` flag when the candidate set was larger than the bounded scan.

Authors add a user-origin `DerivedTool` by supplying it in the plan (`origin: 'user'`); it uses the same templates and the same coverage reporting. Kinds: `inMemoryFilter`, `schemaDiscovery` (search over field names, labels, descriptions) and `crossFieldSearch`.

## 7. Safety invariants

Mapped from synthesis 5.4 items 1-8 and 4.3:

| Invariant | Mechanism |
|---|---|
| 1. Schema or spec only; credentials never stored, logged or echoed | `credentials.ts` scanner runs before any adapter; a finding rejects the input (reject rather than redact); findings carry code, line and kind only, never the matched text |
| Generated config uses env-var placeholders only | `SourceModel.auth` and `backend` hold env var names; snippets use `<NAME>_API_KEY` style placeholders |
| 2. No real data | tabular and DDL adapters accept headers and types only; fixtures are synthetic ("Acme", "Example") |
| 3. Read-only default | only GET and SELECT planned; dropped writes in `writeOperationsDropped` and the report |
| 4. Generated server hygiene | parameterised SQL only, identifiers allow-listed from the model, params validated, timeouts and bounded retries, response size cap (`maxResponseItems`), upstream text treated as untrusted |
| 5. Never guess | ambiguous or unsupported constructs become `Gap` entries with a reason; the affected tool is omitted or marked |
| 6. Python target | `from fastmcp import FastMCP`, stdio, pinned requirements, env var table |
| 7. Flag default off | `mcpGeneratorEnabled()` false unless `MCP_GENERATOR` is 1/true/on/yes |
| 8. No network during generation | pure functions over text; no fs, no fetch in the library |
| No persistence of inputs | input text is processed in memory and not stored; API route does not write it |
| Size caps | `MAX_INPUT_BYTES` 262144 on input, `MAX_OUTPUT_BYTES` 2,000,000 on the generated package |

## 8. Failure modes avoided

From synthesis 4.1, 4.2, 4.4:

- Caller-supplied candidate list (the agentic generator's filter tool took a `products` list and could not fetch anything): derived tools fetch their own candidates.
- Wrong FastMCP import (an arm used the official `mcp` SDK module path): the template imports `from fastmcp import FastMCP`.
- Raw envelopes and 403 JSON reaching the caller, upstream 500s leaking: all tools catch and map errors.
- `str(exception)` copied into output (project 2 error envelope): error messages are fixed strings per category, never derived from the exception.
- Mirroring 30-40 raw fields: projection cap of 12.
- Capability noticed but not exposed as a tool: structural rule emits it.
- Flaky or lenient scoring: generated tests require explicit signals (for example an explicit not-found message), not the absence of error words.
- Environment-coupling hacks (copying installed modules between arms): the package is self-contained with a requirements file.

## 9. Open questions and chosen defaults

Synthesis section 6:

- Q1 Product scope: the author downloads and runs the output. It is a small package directory: `server.py`, `test_server.py`, `requirements.txt`, a README snippet and the generation report (delivered as a zip).
- Q2 Ceilings: an optional author-supplied `limits` block, with conservative defaults and a warning gap when the ceiling is unknown.
- Q3 Tabular input: header, schema and dictionary text only; rows are never ingested (section 3).
- Q4 FastMCP pin: `fastmcp>=3.4,<5`. Verified 2026-10-14: generated test suites (openapi 23, tabular 11, sql 35) pass on fastmcp 3.4.8 and 4.1.0 and the servers answer real MCP calls over stdio on both.
- Q5 LLM layer: none in this phase; deterministic only. A later optional layer would need a separate decision.

## 10. Entry points

- Library API: `src/lib/mcpgen/` (parse, plan, emit); pure, no I/O.
- CLI: `npm run generate-mcp`.
- API route: `/api/mcp-generate` (flag-gated; returns `application/zip`, or `{ok:false, gaps}` on rejection).
- UI: "Generate MCP" entry in the Customize menu (flag-gated; flag off leaves the Phase 4 placeholder untouched).

## 11. Plan map

| Plan | Content | Roadmap criterion covered |
|---|---|---|
| 14-01 | Design doc, flag, contract, registry, credential scanner, diagnostics | 1 design first, 2 adapter extensibility, 3 flag; part of 5 (gaps, not guesses) |
| 14-02 | Core planner (SourceModel to ServerPlan), derived tools | behaviours 1-2, derived-tool extension point |
| 14-03 | OpenAPI adapter | v1 input coverage |
| 14-04 | Tabular and SQL DDL adapters | v1 input coverage, CUST-02 |
| 14-05 | Python emitter, generated tests, report | behaviours 3-9, reproducibility |
| 14-06 | CLI, API route, UI | entry points |
| 14-07 | Invariants and end-to-end tests | safety, wording and flag-off regression |
