# Phase 14 follow-up: which further input kinds for the deterministic MCP generator

**Researched:** 2026-10-14 (branch `autonomous/overnight-improvements`)
**Question (from Ville):** which additional INPUT KINDS (adapters) would work out best for a non-agentic generator, meaning deterministic output and no LLM in the generation loop?
**Domain:** API/schema description formats and how each maps onto `SourceModel` (`src/lib/mcpgen/types.ts`)
**Confidence:** MEDIUM overall. Format facts are HIGH where an official page was fetched or returned by search, MEDIUM where only search summaries were available, and LOW or UNVERIFIED where marked. Effort and ranking are my judgement, not measured.

Read first (all read): `RESEARCH-SYNTHESIS.md`, `docs/mcp-generator-design.md`, `docs/mcp-generator.md`, `docs/agent-types.md` (section 3.11), `src/lib/mcpgen/types.ts`, `adapters/*`, parts of `plan.ts`, `emit/python.ts`, `registry.ts`. Nothing from the external comparison repos was read for this document.

---

## 1. Summary

The generator today has three input kinds and exactly three backend kinds: `http` (GET only, via httpx), `dataset` (one delimited file) and `sql` (read-only SQLite). `Operation.method` is `'GET' | 'SELECT' | 'DATASET'`. That shape decides what is cheap:

- Input kinds that reduce to "an HTTP GET API with typed params and a response schema" (Swagger 2.0, OpenAPI 3.1/3.2 variants, OData, bSDD-style product APIs, SCIM, JSON:API with an OpenAPI document) need NO new backend. They are adapter-only work.
- Input kinds that reduce to "tables and columns" (Prisma, Drizzle schema dumps, `pg_dump --schema-only`, SQLite `.schema`, JSON Schema collections, Parquet schema listings) mostly need dialect work in the adapter. Real catch: the existing `sql-ddl` adapter drops every `ALTER` statement as a "write", and `pg_dump` emits primary and foreign keys as `ALTER TABLE ... ADD CONSTRAINT`, so pg_dump input silently loses its keys today (see `adapters/sql-ddl.ts` line ~230). That is a cheap, high-value fix.
- Input kinds whose reads travel over POST (GraphQL queries, JSON-RPC, gRPC/Connect, SOAP) need ONE core change: a read-only "query" transport. GraphQL is the best of this family: the schema is machine-complete, typed, has a built-in read/write split (Query vs Mutation), and a standard pagination idiom.
- Input kinds that need an LLM (docs only, prose, CLI help text, free-form notes) stay out of scope, for the reasons in section 6.

**Primary recommendation:** build in this order: (1) Swagger 2.0 plus OpenAPI 3.1/3.2 hardening plus OAuth2 bearer-from-env (S); (2) OData CSDL JSON and EDMX (M); (3) GraphQL introspection JSON, then SDL (M to L; introduces the QUERY transport); (4) SQL dialect folding (pg_dump, Prisma) plus a JSON Schema or NDJSON dataset kind (S to M). Defer gRPC/Connect, OpenRPC, SOAP, Kubernetes CRD and AsyncAPI. Reject HAR and Postman-with-examples as inputs, and reject CLI help parsing.

---

## 2. Facts about the formats (as of 2026-10-14)

| Format | Current state | Source | Confidence |
|---|---|---|---|
| OpenAPI | 3.2.0 published 2025-09-23 (patch 3.1.2 same day); builds on 3.1 and JSON Schema 2020-12; adds QUERY method, `querystring` parameter location, tag `kind`/`parent`, streaming media types, OAuth2 device flow. Tooling support for new 3.2 features is uneven. | https://nordicapis.com/whats-new-in-openapi-specification-v3-2-0/ , https://www.speakeasy.com/openapi/release-notes | MEDIUM (two secondary sources) |
| Our openapi adapter | Accepts any `3.x` string (`/^3\./`), rejects Swagger 2.0 with `swagger-2-unsupported`. Handles `type: [x,'null']` and `nullable`. 3.2-only features (QUERY, `querystring`) are not understood; non-GET is dropped. | repo `adapters/openapi.ts` | HIGH |
| GraphQL | September 2025 edition is the first spec revision since October 2021: schema coordinates, OneOf input objects, descriptions on executable documents. graphql-js v17 GA reported 2026-06-15 (single third-party source). | https://graphql.org/blog/2025-09-08-september-edition/ | HIGH (spec), LOW (graphql-js v17 date) |
| Apollo MCP Server | Existing runtime tool: one MCP tool per GraphQL operation file or persisted query; schema to JSON Schema; introspection tool optional (flag). This is a runtime wrapper, not a generator of reviewable source. | https://www.apollographql.com/docs/apollo-mcp-server/define-tools | HIGH |
| OData | CSDL JSON v4.01 and CSDL XML v4.01 are OASIS Standards (approved 2020-05-11). `$metadata` returns the EDMX/CSDL document. | https://docs.oasis-open.org/odata/odata-csdl-json/v4.01/cs01/odata-csdl-json-v4.01-cs01.html , https://www.oasis-open.org/?p=4899 | HIGH on version, MEDIUM on JSON-at-`$metadata` behaviour (not confirmed by search) |
| gRPC to MCP | `protoc-gen-go-mcp` (Redpanda) generates Go MCP servers for gRPC or ConnectRPC from `.proto` via `buf generate`. Confirms the idea works; also confirms it is a code-generator for Go, tied to compiled stubs. | https://redpanda.com/blog/turn-grpc-api-into-mcp-server | MEDIUM |
| AsyncAPI | 3.1.0 is current (released around 2026-01-31, adds ROS 2 binding, no breaking changes). Describes channels and messages for event-driven systems. | https://www.asyncapi.com/blog/release-notes-3.1.0 | MEDIUM |
| OpenRPC | 1.4.x is the latest line; some tooling still emits 1.3.x. Discovery method `rpc.discover`. | https://spec.open-rpc.org/ , https://github.com/open-rpc/spec | MEDIUM |
| Postman | Collection v2.1 JSON is the classic export; v3.0.0 is a multi-file YAML layout (`*.request.yaml`, `definition.yaml`, `.resources/`), with `postman collection migrate`. No Postman-to-MCP generator found by search. | https://learning.postman.com/docs/collections/collections-schemas | MEDIUM |
| HAR | Exports commonly contain session cookies, bearer tokens, URLs and bodies; the Okta support-case incident is the standard cautionary example; sanitising is not fully reliable (tokens also appear in query strings and bodies). | https://www.darkreading.com/application-security/harmor-cleans-sanitizes-encrypts-har-files , https://developers.cloudflare.com/changelog/post/2026-03-25-har-file-detection-and-sanitization/index.md | MEDIUM |
| Terraform | `terraform providers schema -json` output has `format_version` (default 1.0); minor versions are additive, readers must reject unknown majors. | https://developer.hashicorp.com/terraform/cli/v1.12.x/commands/providers/schema | HIGH |
| bSDD (buildingSMART Data Dictionary) | REST API with versioned paths (`api/Class/vX`, `api/Property/vX`); old and new versions both supported for 6 months after a breaking change; some methods need OAuth login (public client id, `read` scope); a Swagger UI exposes the contract. Direct identifier-URL JSON is deprecated. | https://technical.buildingsmart.org/?p=4712 (fetch returned 403; facts from search summary), https://forums.buildingsmart.org/t/bsdd-tech-updates/4889 | MEDIUM; whether its published document is OpenAPI 3.x is UNVERIFIED |
| IFC / IDS | IFC 4.3 is ISO 16739-1:2024 (schema in EXPRESS, XML schema also generated); IDS 1.0 is an approved buildingSMART standard with a published XSD. | https://www.buildingsmart.org/ifc-4-3-approved-as-a-final-standard/ , https://www.buildingsmart.org/standards/bsi-standards/information-delivery-specification-ids/ | MEDIUM (EXPRESS/XSD detail is from secondary pages) |
| CLI wrappers | Existing tools (`cli2mcp`, `any-cli-mcp-server`, `wrapmcp`) parse `--help` at start-up or expose one generic run-CLI tool; all are heuristic or unrestricted. | https://pypi.org/project/cli2mcp/ | MEDIUM |
| MCP spec | Current revision is 2026-07-28. Tools: name rules (1 to 128 chars, `A-Za-z0-9_-.`), `inputSchema`/`outputSchema` default JSON Schema 2020-12, `structuredContent` may now be any JSON value (earlier revisions required an object), `annotations` are untrusted hints, servers SHOULD return tools in deterministic order, `isError` for execution errors. | https://modelcontextprotocol.io/specification/latest/server/tools | HIGH (fetched) |
| FastMCP | 3.x line; one article says v3.4.3 (2026-07-05), a mirror said 3.3.1; a package tracker lists an SSRF and path traversal advisory against the FastMCP OpenAPI provider (affected versions not checked). FastMCP's own docs say curated servers beat auto-converted OpenAPI ones. | https://gofastmcp.com/integrations/fastapi , https://www.agenticwire.news/article/fastmcp-from-openapi | MEDIUM / LOW. Reinforces our design: emit reviewable source, never delegate to a runtime converter. The pin in the design doc is still UNVERIFIED. |

Two MCP-spec consequences worth acting on regardless of input kind (cross-cutting, not new adapters):

1. Emit `outputSchema` (derived from the entity projection) and mirror results into `structuredContent` plus a text block. The projection list is already deterministic, so this is mechanical. Confirm FastMCP 3.x syntax at implementation time.
2. Emit tool annotations with a read-only hint (every generated tool is read-only by construction). The tools page confirms an `annotations` property exists and that clients must treat it as untrusted; the exact field name `readOnlyHint` was not on the fetched page (known from earlier spec revisions: MEDIUM).

---

## 3. Evaluation of each candidate kind

Legend for effort: S = under about 1 day including fixtures and golden tests; M = 2 to 4 days; L = a week or more or needs a core change plus a new dependency decision. "Core change" means anything in `types.ts`, `plan.ts` or `emit/`; the adapter-only rule (`criteria.test.ts` fails if the core imports an adapter) still holds.

### 3.1 Same transport as today (adapter-only)

**Swagger 2.0 (and OpenAPI 3.1/3.2 variants).**
- Determinism: full. Swagger 2.0 maps 1:1 onto the 3.0 structures the adapter already reads (`host`/`basePath`/`schemes` become the `BASE_URL` env; `definitions` becomes `components.schemas`; `securityDefinitions` becomes security schemes; body/formData parameters are non-GET anyway). Implement as an in-adapter normalisation step (a small pure function that returns a 3.0-shaped object) and then reuse the existing pipeline. Do not ship it as a second copy of the adapter.
- SourceModel mapping: identical to `openapi`; gap codes reused (`swagger-2-unsupported` becomes `swagger-2-converted`, severity info).
- Synthesis: unchanged (derived filters on nested arrays).
- Safety: unchanged; `host` is never read as a URL to call. `x-` extensions ignored.
- 3.1/3.2: audit rather than build. Add golden fixtures for `type: [string, null]`, `$ref` siblings, `const`, `examples`, `webhooks`, 3.2 `QUERY` and `querystring` (report `operation-skipped` / `param-dropped` with a clear reason, never crash).
- Effort S. Maturity: Swagger 2.0 is frozen and still very common in older enterprise APIs. Audience: most authors with an existing API have either a 2.0 or a 3.x doc, so this is the cheapest way to remove the most frequent rejection.

**OAuth2 bearer from environment (auth enhancement, not a kind).** Many real product-data APIs (bSDD uses OAuth for secured methods) declare `oauth2`. Today that is a gap (`auth-unsupported`). Cheap, safe option: treat any oauth2/openIdConnect scheme as `bearer` whose token comes from `<NAME>_TOKEN`, and say in the report that token acquisition is out of scope. Do NOT implement flows (no client secrets in generated code). Effort S.

**OData `$metadata` (CSDL JSON and EDMX XML).**
- Determinism: very high. Entity types, keys, properties with Edm types and nullability, navigation properties, entity sets, annotations such as `Org.OData.Capabilities.V1.FilterRestrictions` and `SortRestrictions` (which declare filterable properties) and `Core.Description`. The query protocol is standardised: `$top`, `$skip`, `$filter`, `$select`, `$orderby`, `$count`, `$expand`, paging via `@odata.nextLink`. This means almost no guessing and a uniform tool shape across all services.
- SourceModel mapping: one `Entity` per EntityType (identifier fields from `Key`), `nested` from collection-valued complex properties, one `list` and one `get` Operation per EntitySet (`GET /Set` and `GET /Set(key)`), `maxPageSize` from `Capabilities.TopSupported` or the service's declared max-page-size (usually absent; fall back to the existing `ceiling-unknown` gap), auth from the host spec (none in `$metadata`, so default to bearer-from-env with a gap).
- Synthesis opportunity (strong): per-property typed filter arguments compiled into a validated `$filter` string in the generated runtime (`name_contains`, `price_ge`, ...), instead of exposing a free-text `$filter` expression. That is both better for agents and removes an injection surface. Navigation properties become `expand` allow-lists. Optional derived "filter on nested collection" works the same as for REST.
- Safety: EDMX is XML. Reject any `<!DOCTYPE`/entity declarations before parsing (XXE, billion-laughs); never follow `edmx:Reference Uri` or `edmx:Include` (record `external-reference-not-fetched`); cap element count and nesting depth. Wire names like `$top` are not valid Python identifiers or MCP argument names in many clients: needs `Param.wireName` (section 5).
- Effort M. CSDL JSON first (no XML parser needed, `yaml`/JSON.parse suffices); EDMX second. An XML parser decision is needed for EDMX: either a small hand-rolled tokenizer limited to the EDMX element set (consistent with the sql-ddl approach of "no new dependency") or a logged dependency (for example a pure JS XML parser with entity expansion disabled). I recommend the dependency decision be Ville's (open question 3).
- Maturity: OASIS Standard, stable since 2020. Audience: any organisation with SAP, Microsoft Dynamics/Graph-style or other enterprise back ends; agents that read business data. One invented "Acme Orders" service covers fixtures.

**SCIM 2.0 discovery documents** (`/Schemas`, `/ResourceTypes`, `/ServiceProviderConfig`, RFC 7643/7644). Deterministic and standard (filter syntax, `startIndex`/`count` paging, `ListResponse`), tiny model. But it is identity data (PII), so the safety bar is higher and the audience at a library of agents is narrow. Effort S to M. Rank low; revisit if an identity-lookup agent exists.

**JSON:API.** No schema document of its own (usually described by OpenAPI), so it is not an input kind; it is a response convention the openapi adapter could recognise (`data`/`attributes`/`links.next`/`page[number]`). Treat as an openapi adapter enhancement (pagination detection) if a real spec needs it. Effort S, rank low.

**Building-domain product-data APIs (bSDD and similar).** Not a new kind: they publish OpenAPI (UNVERIFIED which version for bSDD) or CSDL, so they ride on the OpenAPI/OData adapters. What matters is the enhancements above: OAuth2-as-env-token, versioned paths (`/api/Class/v1`), and pagination detection (offset/limit and `offset`/`count` styles are already supported). A generated server over a synthetic Acme-style product dictionary API is enough to test; do not use bSDD data in fixtures. IFC schema, ifcOWL and gbXML are different (section 3.4).

### 3.2 Needs a read-only QUERY transport (one core change)

**GraphQL SDL and introspection JSON.**
- Determinism: high for structure, medium for tool shape. Types, fields, arguments with defaults, nullability, enums, interfaces/unions and descriptions are all explicit. Read/write split is built in: only the `Query` root becomes tools; `Mutation` and `Subscription` are reported as dropped writes (same mechanism as `writeOperationsDropped`).
- Mapping: each `Query` field returning an object or list becomes an Operation (`kind` list when the return is a list or a Relay connection, `get` when it has a scalar ID-like argument and returns one object). Entities from object types; scalars map to `FieldType`; `nested` from list-of-object fields. Relay connections (`edges.node`, `pageInfo { hasNextPage endCursor }`, `first`/`after`) are detected structurally and mapped to cursor paging: this needs a cursor pagination concept in `Operation` (today `pageParam`, `pageSizeParam`, `offsetParam`).
- Synthesis: the strongest of any kind. The generator, not the caller, writes the selection set from the deterministic projection (at most 12 fields, depth-capped), so the agent never composes GraphQL; a field absent from the projection is simply not requested, which is trimmed responses by construction. Arguments typed by input objects can be flattened to scalars when shallow, else reported (`input-object-flattened` / `input-object-unsupported`).
- Safety: the generated server sends only fixed, generator-written query text plus variables (never string-built queries), so GraphQL injection is structural nil. Depth/complexity: the type graph has cycles; the selection builder needs a depth cap and a visited-set. Introspection JSON can be large; the 262,144-byte input cap will reject many real schemas (open question 5). SDL may contain `@link`/federation directives: ignore and report. No URLs are read.
- Core change: `Operation.method` gains a read-only POST variant, and the http runtime template gains a `post_query` helper that applies the same retry, clamp, error-mapping and size-cap code as `get_json`. Everything in the behaviour checklist transfers.
- Parsing: introspection JSON needs only `JSON.parse`. SDL needs a parser: either a logged dependency on the reference `graphql` package (parse only, never execute) or a hand-rolled SDL parser. SDL grammar is small but has block strings, comments and extension syntax; hand-rolling is risky. I recommend introspection JSON first (no dependency), SDL second behind a dependency decision.
- Effort L overall (M for the adapter, M for the transport change plus emitter template plus generated tests). Maturity: very high (Sept 2025 edition). Audience: authors of modern product or content platforms; strong demand because agents are told to avoid hand-writing GraphQL.

**OpenRPC / JSON-RPC.**
- Determinism: high for shapes (`methods[].params`, `result` as JSON Schema, `errors`). Weak point: OpenRPC has no read/write marker, so the generator cannot tell `get_balance` from `transfer`. Under "never guess" the only safe read-only rule is an explicit author allow-list (`allowRead` option) or an `x-` hint; otherwise every method is a gap. That makes the output small and the effort wasted unless authors supply the allow-list.
- Core change: same QUERY transport as GraphQL (POST JSON-RPC envelope, `id` handling, batch disabled).
- Effort M after GraphQL; maturity moderate (1.4.x, tooling mixed). Rank medium-low.

**gRPC / protobuf `.proto` (and ConnectRPC).**
- Determinism: high for message and service structure. Read-only marker exists in the language: a method option `idempotency_level = NO_SIDE_EFFECTS`, and `google.api.http` `get:` annotations; most real files lack both, so again an allow-list is needed. Streaming methods (server, client, bidi) are not representable as one tool call: report and drop.
- Runtime: a gRPC call needs generated stubs or `grpcio` reflection (more dependencies in the generated package, and the server must run protoc), which conflicts with the "small self-contained package" design. The Connect protocol and gRPC-JSON transcoding (HTTP+JSON) avoid this; the generated server could use httpx. (Connect's GET support for side-effect-free unary methods is from my memory of the protocol: UNVERIFIED, check before relying on it.)
- Parsing: `.proto` needs a real parser (a dependency such as protobufjs, or consume a descriptor set JSON). Imports must never be resolved from disk or network.
- Effort L (parser, imports, transport, allow-list). Maturity: very high. Audience: platform/backend teams. Rank medium-low for this phase; the existing runtime wrappers (protoc-gen-go-mcp) already serve Go shops.

**WSDL / SOAP.** Deterministic structure (WSDL 1.1 plus XSD) but verbose XML, no read/write marker, XML Schema complexity (choice, extension, imports to remote XSDs), SOAP envelopes. Highest effort for the least modern audience. Rank last among API kinds; revisit only if a concrete legacy system is named.

**AsyncAPI.** Describes channels and message payloads, not request/response. MCP tools are call/response, so there is no honest tool mapping beyond a "message schema reference" server (see 3.4) or an author-declared request/reply operation. Rank low. If wanted, support only the `reply`/request-reply subset (3.0) and report everything else.

### 3.3 Data and schema files (dataset and sql backends)

**SQL dialect folding: `pg_dump --schema-only`, SQLite `.schema`, MySQL `SHOW CREATE TABLE`.** Same `sql-ddl` adapter; the work is folding `ALTER TABLE ... ADD CONSTRAINT PRIMARY KEY/FOREIGN KEY/UNIQUE` into the table model instead of dropping it as a write, accepting `CREATE TABLE ONLY`, schema-qualified names and Postgres types (`serial`, `timestamptz`, `text[]`, `jsonb`), and reporting views and indexes. The generated backend is still SQLite (`<NAME>_DB_PATH`), so the author must supply an equivalent file; state that in the report. Safety: pg_dump text from `--schema-only` has no row data, but COPY blocks appear if the author used a data dump; the adapter already ignores data statements and the credential scan runs first; also reject any input containing a `COPY ... FROM stdin` data block (`rows-rejected` analogue). Effort S. SQLite `.schema` is already valid DDL for the current adapter (verify with a fixture).

**Prisma schema, Drizzle schema, SQLAlchemy/Django models.** Prisma `schema.prisma` is a small declarative DSL (models, fields, `@id`, `@relation`, enums): deterministic and parseable by hand. Drizzle and SQLAlchemy are TypeScript/Python code: reading them means parsing a programming language or importing it (execution). Reject the code forms; support Prisma only, and only as text. Datasource block contains `url = env("DATABASE_URL")` or a literal URL (credential-bearing): the credential scan already rejects URL userinfo; additionally ignore the whole `datasource` block. Effort S to M. Audience: web teams. Maturity: Prisma schema language is stable.

**JSON Schema collections (a folder of schemas, one per entity) and JSON/NDJSON data files.** JSON Schema 2020-12 is a stable standard, and the MCP spec itself defaults to it. Mapping: each top-level schema becomes an Entity (required fields, `format`, `enum`, `minimum`/`maximum`); a `dataset` backend variant reads NDJSON or a JSON array from `<NAME>_DATA_FILE`. This also fixes today's limitation "dataset backend emits the first entity only" (plan gap `dataset-multiple-entities`), a core improvement that benefits tabular input too. Safety: `$ref` to URLs is never fetched (report); `$schema`/`$id` URLs are only strings. Effort M (needs a JSON reader runtime template and multi-entity datasets). Maturity: very high. Audience: authors with data exports or event payload schemas.

**Parquet, Excel, CSV (beyond headers).** The input should stay text: a Parquet schema printout (`parquet-tools schema`, DuckDB `DESCRIBE`) maps to columns and types and would produce a `dataset` entity; but a Parquet runtime needs `pyarrow` or `duckdb` in the generated package (heavy dependency). Binary `.xlsx` or `.parquet` uploads are not text and would carry rows; keep them unsupported (consistent with D-150: no row ingestion). Effort M (runtime dependency decision). Rank low.

### 3.4 "Reference" servers from schema-of-schemas (needs an embedded backend)

Kubernetes CRDs (OpenAPI v3 schema in YAML), Terraform provider schemas, IFC EXPRESS/XSD, gbXML XSD, IDS XSD, AsyncAPI documents and Prisma-like metadata can all drive a different server type: one that does not call a backend but answers questions about the schema itself (what attributes does entity X have, what is the type hierarchy, which properties are required), using `schemaDiscovery` over data embedded in the generated package. This is deterministic and very low risk (no network, no credentials, no row data) and it fits an organisation that curates agents for domain work (a building-data agent that must look up standard classes and property names without hallucinating them). Costs: a new backend kind `embedded` in the core, package size (the 2,000,000-byte output cap and a size judgement for large standards; IFC 4.3 is big), and licence terms of the embedded standard text (check before shipping any real schema; fixtures stay synthetic). Effort M for the backend plus S per format. I rank the idea high on value-for-risk but it is a different product shape ("schema reference server"); put it to Ville as an option (open question 6) rather than assuming it.

Terraform: the `providers schema -json` output is also credential-free by nature but can be several MB; cap and slice by provider. CRDs: the live cluster (kubeconfig/bearer) is the runtime side and is out of scope; only the schema reference use case is safe.

### 3.5 Inputs to reject or treat as out of scope

| Kind | Verdict | Reason |
|---|---|---|
| HAR captures | Reject | Credential-bearing by nature (cookies, Authorization, tokens in URLs and bodies); contains real data; the existing scanner would reject nearly every real file anyway; inference of an API from traffic is guesswork (no types, no pagination contract). Do not even offer a redaction mode: redaction is unreliable (https://www.darkreading.com/application-security/harmor-cleans-sanitizes-encrypts-har-files). |
| Postman / Insomnia / Bruno collections | Low and risky; supported only as a thin, optional adapter later | Collections hold saved example values and environment variables (credentials and real data live there), request bodies are examples not schemas, there is no response typing unless saved examples exist (sample values violate the no-real-data rule), and most collections are write-heavy. If requested: accept v2.1 JSON, ignore all `variable`, `auth`, `event` blocks and header values, take only method + path template + parameter names, use GET requests only, and type everything `string` with a gap. Value is low compared with the OpenAPI the collection was usually exported from. |
| CLI help output / man pages | Out of scope as an input | Help text is free-form prose; parsing is heuristic and varies by framework version (the existing tools say as much). Output would depend on guesses, violating "never guess". The generated server would also have to execute processes, the opposite of the read-only safe class. See section 6 for a safe declarative alternative. |
| Python/TypeScript signatures, `.pyi` stubs | Out of scope | Needs a language parser or importing the code (execution). A library API with an OpenRPC or OpenAPI description is already covered. |
| Docs-only, RSS/Atom | Docs: out (needs an LLM); RSS/Atom: not an input kind | Docs-only needs grounding and inference. RSS/Atom has a fixed, standard shape (title, link, items), so there is nothing to adapt: the input is just a feed URL, which would be a URL-as-input (SSRF-prone, forbidden at generation). A fixed "feed reader" template is possible but is a template, not an input kind. |

---

## 4. Ranked recommendation

Scores are 1 (low) to 5 (high). Value = expected use by agent authors at a library that curates agents plus how much the format yields a good server without guessing. Risk is higher = worse (credentials, execution, SSRF, parser danger). Rank blends value, ease and risk.

| Rank | Input kind | Value | Effort | Risk | Needs core change | New dependency | Determinism |
|---|---|---|---|---|---|---|---|
| 1 | Swagger 2.0 normalisation plus OpenAPI 3.1/3.2 audit plus OAuth2 as bearer-from-env | 5 | S | 1 | no | no | full |
| 2 | OData CSDL JSON (then EDMX XML) | 4 | M | 2 (XML) | small (`Param.wireName`; optional OData filter template) | EDMX only (decision) | full |
| 3 | GraphQL introspection JSON (then SDL) | 5 | L | 2 | yes (QUERY transport, cursor paging) | SDL only (decision) | high |
| 4 | SQL dialect folding (pg_dump, SQLite, Prisma) | 3 | S | 1 | no | no | full |
| 5 | JSON Schema collection plus NDJSON/JSON dataset (also multi-entity dataset) | 3 | M | 1 | yes (dataset multi-entity, JSON reader) | no | full |
| 6 | Schema reference server (CRD, Terraform, IFC/XSD) via `embedded` backend | 3 to 4 (domain dependent) | M | 1 | yes (new backend kind) | no | full |
| 7 | OpenRPC | 2 | M | 2 | yes (shares GraphQL QUERY) | no | high, but needs read allow-list |
| 8 | gRPC / proto (+Connect) | 3 | L | 2 | yes | parser | high, needs allow-list |
| 9 | SCIM discovery | 2 | S to M | 3 (PII) | no | no | full |
| 10 | AsyncAPI (request/reply subset) | 1 | M | 1 | no | no | high |
| 11 | WSDL / SOAP | 1 | L | 2 | yes | XML | medium |
| 12 | Postman / Insomnia / Bruno | 1 | S | 4 | no | no | low |
| none | HAR, CLI help, code signatures, docs-only | n/a | n/a | rejected | n/a | n/a | not deterministic or unsafe |

Why this order: ranks 1 and 4 remove frequent failures at near-zero risk; rank 2 gives a whole class of enterprise services with a standardised query language and no core redesign; rank 3 has the highest synthesis payoff (the generator writes the queries) but is the first change to the core transport, so it follows two cheap wins and reuses learning from OData (wire names, typed filter compilation).

---

## 5. Recommended build order (next 3 to 4 adapters) and minimal viable scope

### Adapter A: `swagger2` normalisation inside the `openapi` adapter family (S) plus 3.1/3.2 audit
- Supports: Swagger 2.0 JSON or YAML; GET operations only; `definitions`, `parameters` (`in: query|path|header`), `securityDefinitions` (`apiKey`, `basic` rejected as unsupported, `oauth2` as bearer-from-env), array/object schemas, `x-nullable`.
- Reports as gaps: `swagger-2-converted` (info), `host` ignored (info), non-GET dropped (existing), `consumes/produces` non-JSON (`unsupported-media-type`), `formData`/body params (dropped with the write), `$ref` outside `#/` (existing external-ref gap).
- Also: OpenAPI 3.2 `QUERY` method and `querystring` parameters reported (`operation-skipped`, `param-dropped`); oauth2/openIdConnect mapped to bearer-from-env with `auth-oauth-token-env` info gap.
- Registry: either keep id `openapi` and let `detect` accept Swagger 2.0 (preferred: no new id), or add id `swagger2` forced-only.

### Adapter B: `odata-metadata` (M)
- Supports: CSDL JSON v4/4.01 first; then EDMX (XML) v4.0/4.01. EntityType, ComplexType, EntitySet, Key, primitive Edm types, navigation properties (as `get`-style expand allow-list, depth 1), `Capabilities` annotations for filterable/sortable properties, `Core.Description`.
- Operations: `list` per EntitySet (`$top`/`$skip` or `@odata.nextLink`), `get` by key (single and simple composite keys), `count` as part of list meta.
- Tool shape: typed per-property filters compiled into `$filter` by a fixed runtime helper, `fields` mapped to `$select`, `max 12` projection retained.
- Reports: actions/functions/bound operations (unsupported, may have side effects; functions with `IsComposable` could be a later phase), `Edm.Stream`, `Edm.Geography*` (unsupported-type), OData v2/v3 documents (`odata-version-unsupported`), `edmx:Reference` (not fetched), open types, derived-type hierarchies (flattened with info gap), singletons (list as get without key).
- Hardening: reject DOCTYPE/entity declarations; limit entities (for example 100) and total properties; sanitise names to valid tool names (spec: `A-Za-z0-9_-.`, at most 128 chars).

### Adapter C: `graphql-introspection` (and `graphql-sdl` second) (L)
- Supports: introspection result JSON (`data.__schema` or `__schema`); only `Query` root fields; scalars/enums/object types/list and non-null wrappers; connection pattern (cursor pagination); arguments of scalar, enum and one-level input-object types.
- Core: QUERY transport (read-only POST with a fixed generated query document and variables), cursor paging fields in `Operation`, selection-set builder from the projection with depth cap 3 and cycle guard.
- Reports: Mutation and Subscription fields (dropped writes), interfaces/unions (merged only with explicit type conditions, else `union-unsupported`), custom scalars (`unknown-type`), directives (ignored, info), deprecated fields (omitted by default with `deprecated-field-omitted`), federation `_entities`/`_service` (ignored).
- SDL follows only after a dependency decision.

### Adapter D: `sql-ddl` dialect folding plus `prisma` (S) and `json-schema-dataset` (M)
- D1 (S): fold `ALTER TABLE ... ADD CONSTRAINT/PRIMARY KEY/FOREIGN KEY` into tables; accept `CREATE TABLE ONLY`; recognise Postgres types; reject `COPY ... FROM stdin` data blocks. Prisma: models, scalar types, `@id`, `@@id`, `@relation`, enums; ignore `datasource` and `generator` blocks.
- D2 (M): JSON Schema collection to entities plus a NDJSON dataset runtime and multi-entity dataset support (fixes `dataset-multiple-entities`).

Defer to a later phase: embedded reference servers (needs a product decision), OpenRPC, gRPC/Connect.

---

## 6. Required SourceModel and interface changes (proposals; verify against the code when planning)

Existing structure is mostly sufficient. Changes, smallest first:

1. `Param.wireName?: string` (the name on the wire when it differs from the tool argument name; needed for `$top`, `filter[x]`, `X-Foo` headers, GraphQL variables). Backwards compatible. Emitter must keep validating the argument name as an identifier.
2. `Operation.method` gains a read-only POST variant (for example `'QUERY'`), plus an optional `Operation.protocol?: 'rest' | 'odata' | 'graphql' | 'jsonrpc'` so the planner picks the right runtime template. The "never write" invariant must be restated precisely: QUERY means a read-only query language call whose body is generator-written, and the credential/read-only tests must assert that no Mutation or non-allow-listed method ever reaches a tool.
3. Cursor pagination: `Operation.cursorParam?`, `Operation.nextCursorPath?` (GraphQL connections, OData `nextLink`, many REST APIs). Today only page and offset exist.
4. `Entity` relations: `Entity.references?: { field; entity }[]` for foreign keys and navigation properties (SQL FKs are read but there is no model field for them; verify). Enables `expand`/join-like tools later; not needed for the MVP.
5. `backend.kind` gains `'embedded'` only if the reference-server option is chosen.
6. `Gap` codes to add (adapter-specific, all severity-tagged; no core change): `swagger-2-converted`, `external-reference-not-fetched`, `doctype-rejected`, `depth-capped`, `cycle-broken`, `union-unsupported`, `streaming-unsupported`, `read-allowlist-required`, `auth-oauth-token-env`. The existing generic codes (`unsupported-type`, `write-dropped`, `operation-skipped`, `param-dropped`) cover the rest.
7. `GenerateOptions.allowRead?: string[]` (only for kinds without a read marker: OpenRPC, gRPC). Absent = all methods are gaps.
8. `InputAdapter.detect` stays a pure function; for XML and JSON kinds add cheap prefix sniffing (`<edmx:Edmx`, `"__schema"`, `"swagger"`, `"$metadata"`), keep confidence below 1 and rely on forced `--adapter` in ambiguity (existing behaviour).
9. Size cap: `MAX_INPUT_BYTES` is 262,144. Large GraphQL introspection files and OData metadata routinely exceed this. Options in open question 5.
10. Cross-cutting emitter additions (all kinds): `outputSchema` and `structuredContent`, read-only annotations, tool-name sanitiser that enforces the MCP name rule (1 to 128 chars of `A-Za-z0-9_-.`). Keep deterministic ordering (the spec now says SHOULD).

`criteria.test.ts` (core must not import adapters) and the single-line registration in `adapters/index.ts` remain the contract. Adapter-only items (Swagger 2.0, SQL folding, Prisma, CSDL JSON without wire names) can land without touching the core, which is the right test of the architecture.

---

## 7. Test fixture strategy (synthetic only)

Rules (carry over from the existing fixtures `testing/fixtures/acme-*`): invented "Acme" or "Example" names; no real catalogs, hosts, keys, product numbers; one good fixture, one `*-bad` fixture, and negative fixtures per kind.

Per adapter:
1. `acme-<kind>.<ext>`: small but representative (3 to 5 entities, one nested collection, one paged list, one enum, one nullable field, one unsupported construct).
2. `acme-<kind>-bad.<ext>`: malformed input; expect `parse-failed` or the specific gap, never a throw (existing registry guarantees).
3. Credential-bearing variant (inline token in an example, URL with userinfo, `Authorization:` header value): expect `credential-rejected` before the adapter runs.
4. Hostile input: EDMX with `<!DOCTYPE` and entity expansion; introspection JSON with a deep self-referential type cycle; proto/XSD/JSON Schema with remote `$ref`/`import`/`schemaLocation` URLs (assert no network call: the library has none, and assert the gap is reported); oversize input (`input-too-large`); wide schema (hundreds of types: budget gap, as in `openapi.budget.test.ts`).
5. Golden output files in `__golden__/` per adapter (byte-identical), and a double-run determinism test.
6. `py_compile` test on the generated `server.py` (guarded by `python3` availability, as today) and generated pytest against a stub upstream. For QUERY and OData runtimes the stub must assert the exact request the generated code builds (the fixed query text or `$filter` string), including that special characters in arguments are escaped and that no argument ever reaches the query text unescaped.
7. Invariant tests (`14-07` style): output contains no URLs, no secrets, none of the banned leak patterns; read-only assertions (no Mutation field, no non-GET OData action, no write method in any tool).
8. Pre-existing fixtures to cover cheap kinds with no new adapters: a SQLite `.schema` sample, a pg_dump-style schema with `ALTER TABLE ... ADD CONSTRAINT` (currently expected to lose keys: write the failing test first), a Swagger 2.0 version of the existing `acme-openapi.yaml` so the golden output can be compared with the 3.0 result (same tools expected).

---

## 8. What "non-agentic generators" could also mean

Interpretations and what each would imply:

1. **No LLM in the generation loop (the current meaning).** Reproducible, reviewable, cheap, auditable; the study showed deterministic emission of behaviours beats prompting for them. Implication: inputs must carry enough structure; anything else becomes a gap. This document is entirely under this meaning.
2. **Generators of non-agent MCP servers.** Already the case: an MCP server is a tool provider, not an agent (`docs/agent-types.md` section 1 and 3.11 make `mcp-server` its own kind). Implications for the catalog: (a) record provenance on the entry (generator version, adapter id, input hash, `report.json`) so reviewers know the server was generated deterministically and what it dropped; (b) generate the registry `server.json` metadata and an AgentSpec `MCPToolBox`/`MCPTool` snippet so an agent record can reference the server, which ties the generator to the library's canonical format; (c) Try It Out stays external or not runnable, as decided for MCP servers.
3. **Wrapping existing CLIs (and other local programs).** A different backend class, `subprocess`. It breaks two current invariants: servers never execute arbitrary programs, and reads are provably read-only. A deterministic, safe version exists only as a declarative manifest authored by a human (command template, allow-listed subcommands, typed arguments, no shell, fixed environment, timeouts, output size cap), not as parsed help text. That is a separate input kind ("cli-manifest") with its own flag, its own safety review and a prominent report; I would not build it until there is a named use case. Heuristic help-text parsing (what cli2mcp-style tools do) is not deterministic across tool versions and I recommend against it.
4. **A generator that is not an agent.** Our generator is already non-agentic in the process sense (no autonomy, no tool use, no network, no persistence). Keep that framing in the docs: the "agent" distinction in this repo is about runtime consumers of MCP servers, not about how the server was made.
5. **Other deterministic emitters from the same `SourceModel`** (orthogonal to input kinds): a TypeScript server (official SDK) for authors who prefer Node, an OpenAI-style function-tool JSON file, or an Agent Skill folder (`SKILL.md` plus reference files describing the same tools). Cheap once the `ServerPlan` is stable (planner untouched, a second emitter). Worth asking about; not researched in depth.

---

## 9. Pitfalls specific to adding adapters

- **Silent key loss** (pg_dump `ALTER` constraints) is the kind of defect the "never guess" rule should surface: when a table ends with no primary key and the input contained ALTER statements, add a distinct gap rather than only `no-identifier`.
- **Name collisions and illegal names.** GraphQL, OData and proto names can collide after sanitising (case or namespace differences). The existing collision-suffix rule must be applied after sanitising to MCP-legal tool names.
- **Type fidelity gaps**: Edm.Decimal/Int64 beyond 2^53 (JSON precision), GraphQL custom scalars (`DateTime`, `JSON`, `BigInt`), proto `int64` as JSON strings. Map to `string` with a gap rather than `number`.
- **Pagination ceilings** are rarely declared (same as REST): keep the `ceiling-unknown` warning and `limits` option.
- **Leak-word rule**: error shape keys must keep to `ok/kind/message/hint`; the new runtimes (GraphQL `errors` arrays, OData `error` objects) must never be passed through.
- **Dependency creep**: each new parser (XML, GraphQL SDL, proto) is a supply-chain and review cost for a platform that has kept `mcpgen` dependency-free. Prefer JSON-shaped inputs first (CSDL JSON, introspection JSON, descriptor sets), which need no parser.
- **Spec drift**: OpenAPI 3.2, MCP 2026-07-28 and FastMCP 3.x are moving; version-check at implementation time (the FastMCP pin remains UNVERIFIED).

---

## 10. Open questions for Ville

1. **Audience first:** which real systems do the AIC authors want to wrap (REST with Swagger 2.0, enterprise OData, a GraphQL product API, SQL exports, building-data standards)? A single concrete example would reorder the ranking more than any analysis here.
2. **Reference servers:** do you want the "schema reference server" shape (domain standards such as building-data schemas answered from embedded schema data), which needs an `embedded` backend and a licence check for each standard, or only servers over live APIs/data?
3. **Dependencies:** is a small, logged dependency acceptable for EDMX XML parsing and GraphQL SDL (and later proto)? If not, scope is CSDL JSON, introspection JSON and hand-rolled Prisma only.
4. **QUERY transport:** is a core change acceptable in Phase 14 (a new `Operation.method` variant) or should POST-based kinds wait for a later phase so the Phase 14 core stays frozen?
5. **Input size cap:** `MAX_INPUT_BYTES` is 262,144; real GraphQL introspection and OData metadata files are often larger. Raise the cap for specific adapters, accept a stripped or sliced input, or leave as a documented limitation?
6. **Read/write allow-lists** for kinds without a read marker (OpenRPC, gRPC): accept an author-supplied `allowRead` list, or exclude those kinds altogether?
7. **Auth:** is "OAuth2 token supplied by the author in an env var, no flow implemented" acceptable for product-data APIs that use OAuth?
8. **Interpretation of "non-agentic":** besides section 8 item 1, does Ville also mean item 3 (wrapping existing CLIs) or item 5 (other emitters, such as an Agent Skill or AgentSpec snippet)?
9. **Postman/Insomnia/Bruno:** is there demand strong enough to justify a deliberately thin, GET-only, values-ignored adapter, given the credential and example-data risk?
10. **Provenance in the catalog:** should a generated server's entry record generator version, adapter id and input hash (needs an `mcp-server` field decision)?

---

## 11. Sources

Primary (fetched or official):
- MCP tools specification (current revision 2026-07-28): https://modelcontextprotocol.io/specification/latest/server/tools
- Terraform `providers schema`: https://developer.hashicorp.com/terraform/cli/v1.12.x/commands/providers/schema
- GraphQL September 2025 edition announcement: https://graphql.org/blog/2025-09-08-september-edition/
- OData CSDL JSON v4.01 (OASIS): https://docs.oasis-open.org/odata/odata-csdl-json/v4.01/cs01/odata-csdl-json-v4.01-cs01.html
- Apollo MCP Server (tool definition from operations): https://www.apollographql.com/docs/apollo-mcp-server/define-tools
- AsyncAPI 3.1.0 release notes: https://www.asyncapi.com/blog/release-notes-3.1.0
- OpenRPC spec: https://spec.open-rpc.org/
- Postman collection schemas: https://learning.postman.com/docs/collections/collections-schemas
- buildingSMART IFC 4.3 approval: https://www.buildingsmart.org/ifc-4-3-approved-as-a-final-standard/ ; IDS: https://www.buildingsmart.org/standards/bsi-standards/information-delivery-specification-ids/

Secondary (search summaries, MEDIUM):
- OpenAPI 3.2: https://nordicapis.com/whats-new-in-openapi-specification-v3-2-0/ , https://swagger.io/blog/swagger-launches-support-for-openapi-3-2-0/ , https://www.speakeasy.com/openapi/release-notes
- gRPC/Connect to MCP: https://redpanda.com/blog/turn-grpc-api-into-mcp-server , https://enterprisedb.com/blog/building-mcp-servers-protobuf-part2-automate-mcp-server-creation-protoc-plugins
- bSDD API: https://technical.buildingsmart.org/?p=4712 (direct fetch returned 403), https://forums.buildingsmart.org/t/bsdd-tech-updates/4889
- HAR risk: https://www.darkreading.com/application-security/harmor-cleans-sanitizes-encrypts-har-files , https://developers.cloudflare.com/changelog/post/2026-03-25-har-file-detection-and-sanitization/index.md
- CLI wrappers: https://pypi.org/project/cli2mcp/
- FastMCP: https://gofastmcp.com/integrations/fastapi , https://www.agenticwire.news/article/fastmcp-from-openapi

Tertiary / UNVERIFIED (flagged in text): graphql-js v17 GA date; whether bSDD's published contract is OpenAPI 3.x; Connect-protocol GET for side-effect-free methods; FastMCP OpenAPI SSRF advisory affected versions; exact MCP `readOnlyHint` field on the 2026-07-28 page; whether OData `$metadata` serves CSDL JSON on request.

## 12. Metadata

- Standard formats and maturity: HIGH for OpenAPI, GraphQL, OData, Terraform, MCP; MEDIUM for AsyncAPI, OpenRPC, Postman, bSDD.
- Effort and ranking: MEDIUM (judgement based on reading the current adapters and planner; not prototyped).
- Existing-code claims (backends, GET-only, ALTER handling, size cap, 3.x acceptance): HIGH (read from the repo).
- Valid until: about 30 days for format versions (OpenAPI 3.x, MCP, FastMCP move fast); structure and safety reasoning is stable.
