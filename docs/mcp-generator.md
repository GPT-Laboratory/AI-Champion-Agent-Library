# Phase 14: MCP generator (flagged)

A deterministic generator that turns a schema or specification into a small Python FastMCP (stdio) server package. The design and its reasoning are in [mcp-generator-design.md](mcp-generator-design.md); this page is the user and extension guide.

## Overview and flag

The web route and the Customize menu entry are behind `MCP_GENERATOR`, default off. Accepted values are `1`, `true`, `on`, `yes` (case-insensitive), read at call time by `mcpGeneratorEnabled()` in `src/lib/flags.ts`.

```bash
MCP_GENERATOR=1 npm run dev
```

With the flag off: `POST /api/mcp-generate` answers 404, the detail page load has no `mcpGeneratorEnabled` key, and the Customize menu shows only the three Phase 4 "Coming soon" items. With the flag on, the menu gains an enabled "Generate MCP" item that opens a paste-and-download panel. The CLI is an author tool and works regardless of the flag (like `validate-submission`, D-153).

The generator reads schema or specification text only. It never reads data, never contacts a network, never executes the Python it writes, and stores nothing.

## Inputs and accepted text formats

One adapter per input type. The registry detects the best match, or you force one with `--adapter` / the panel select. A forced adapter that does not fit is rejected; there is no fallback.

### openapi

Swagger 2.0 (`swagger: "2.0"`) and OpenAPI 3.0, 3.1 and 3.2, as YAML or JSON, all read by this one adapter (id `openapi`; auto-detect prefers it for both, D-520). Local `#/` references only; external references and anchors are reported and never fetched. Only GET operations become tools; every other method is listed in the report as dropped. The `servers` URL and defaults are never read; the server gets a `<NAME>_BASE_URL` variable instead (for Swagger 2.0 the same holds for `host`, `basePath` and `schemes`: put the full address, including any base path, in the variable). Response examples are never copied into the output; they are read only to check them against their own schema (gap `example-schema-mismatch`, below).

```yaml
openapi: 3.0.3
info: { title: Acme Parts API, version: "1.0.0" }
paths:
  /parts:
    get:
      operationId: listParts
      parameters:
        - { name: q, in: query, schema: { type: string } }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: array
                items: { type: object, properties: { partId: { type: string }, name: { type: string } } }
```

#### Swagger 2.0

A Swagger 2.0 document is normalised inside the adapter (`adapters/openapi-swagger2.ts`) into the same model path as OpenAPI 3.x: `definitions` are resolved in place with the same memoisation and budgets, `#/parameters/...` and `#/responses/...` references work, query and path parameters carry `type`, `enum`, `minimum` and `maximum`, and `x-nullable` marks a nullable field. `produces` (operation, then document) decides whether a JSON response exists; if it lists no JSON type the operation is omitted with `missing-response-schema`. `consumes`, body and formData parameters belong to write operations, which are dropped like every non-GET method; a body or formData parameter on a GET is ignored and reported (`swagger2-body-param-ignored`, info). `securityDefinitions` of type `apiKey` (header or query) and `oauth2` are supported; `basic` is reported as `auth-unsupported` and no credentials are sent. A Swagger 2.0 document is never fetched or converted by an outside service.

#### OAuth2 and OpenID Connect

For a Swagger 2.0 `oauth2` definition and an OpenAPI 3.x `oauth2` or `openIdConnect` scheme no flow is implemented (D-521). The generated server reads a bearer access token from `<PREFIX>_ACCESS_TOKEN` (for example `ACME_LEDGER_ACCESS_TOKEN`), described as "OAuth2 access token obtained by you; never stored", and sends `Authorization: Bearer <token>` on every request. It never contacts an authorization or token endpoint, never refreshes a token and never writes one anywhere; scopes are not checked. The generator reports `oauth2-flow-not-implemented` (warn). If the token is missing the tool fails with a fixed message naming the variable. Other schemes keep their variables (`<PREFIX>_API_KEY`, `<PREFIX>_TOKEN` for `http` bearer). The credential scanner is unchanged: a token or client secret found in the input rejects it.

#### OpenAPI 3.1 and 3.2

Supported: `type: [x, "null"]` and `nullable` (a nullable field), `$ref` next to annotation keywords such as `description`, schema `example` and `examples` (array) for the example check, local `$defs` references, `components.pathItems` referenced from `paths`, `$self` (ignored, nothing is resolved against it), and the `device authorization` OAuth2 flow (same access-token behaviour). Everything else the adapter does not model is reported with a stable code, see the table below; nothing is guessed.

### tabular-catalog

Header and dictionary text for a spreadsheet-style catalog. Rows are never ingested: at most 5 sample rows are accepted (used only to infer types, values are not stored) and more than 5 is rejected (`rows-rejected`, D-150). Format:

```text
WG010,WG020,WG030
Widget code,Widget name,Quantity
ZZ-9001,Sample gizmo,12
# dictionary
code,label,type,description
WG010,Widget code,string,Stable widget code
WG030,Quantity on hand,integer,
# options
name=Acme Widgets
entity=widget
skip_rows=1
identifier=WG010
```

The first line holds column codes. `skip_rows` is the number of label lines after the header to skip. `# dictionary` rows are `code,label[,type[,description]]`. `# options` accepts `skip_rows`, `identifier`, `entity`, `name`. The generated server reads the real file at run time from `<NAME>_DATA_PATH`.

### sql-ddl

`CREATE TABLE` statements (CUST-02, D-151) from plain SQL, `pg_dump --schema-only`, SQLite `.schema` / `.dump` and `mysqldump --no-data` (D-540..D-545): primary keys (inline, table-level, composite, or added with `ALTER TABLE ... ADD CONSTRAINT`), foreign keys, unique constraints, quoted names (double quotes, backticks, `[brackets]`), comments, `IF NOT EXISTS`, schema-qualified names (`public.customer` becomes `customer`).

```sql
CREATE TABLE customer (
  customer_id INTEGER NOT NULL PRIMARY KEY,
  customer_name VARCHAR(80) NOT NULL,
  city TEXT
);
```

How the dialects are read:

- **ALTER TABLE.** `ADD [CONSTRAINT x] PRIMARY KEY (...)`, `FOREIGN KEY (...) REFERENCES t (...)` and `UNIQUE (...)` are folded into the table (pg_dump writes its keys this way; before D-540 they were dropped as writes and the keys were lost). `CHECK` is tolerated. `ALTER COLUMN ... SET NOT NULL` is folded. `SET DEFAULT nextval(...)`, identity changes and `OWNER TO` are ignored quietly. Every other ALTER (`ADD COLUMN`, `DROP ...`, `RENAME`) is a reported write (`statement-ignored`, listed in `writeOperationsDropped`).
- **COPY data.** A `COPY t (cols) FROM stdin;` block (a pg_dump made without `--schema-only`) is removed before anything else reads the text. Only the number of lines is reported (`data-rows-skipped`); no row is parsed, kept or echoed, and the credential scan sees only the text outside the blocks, so a dump with data is not rejected for its rows. Everything outside the blocks (an `INSERT`, a comment, a header) is still scanned. psql meta-lines (`\connect`, `\restrict ...`) are dropped.
- **Types.** `serial`, `bigserial`, `integer`, `bigint` map to integer; `numeric(p,s)`, `double precision`, `real` to number; `boolean` to boolean; text, `varchar(n)`, `uuid`, `date`, `timestamp`, `timestamptz` to string; `jsonb`, `json`, arrays (`text[]`) and composite types become string with an `unsupported-type` gap; unknown types (`bytea`, `inet`) become string with an info gap. `CREATE TYPE ... AS ENUM (...)` (PostgreSQL) and inline `enum(...)` (MySQL) become the allowed values of the column (`Field.enum`).
- **Noise.** `SET`, `SELECT pg_catalog.set_config`, `COMMENT ON`, `CREATE SEQUENCE`, `CREATE EXTENSION`, `CREATE SCHEMA`, `CREATE INDEX`, `GRANT`/`REVOKE`, `DROP ... IF EXISTS`, `LOCK TABLES`, `PRAGMA`, `BEGIN`/`COMMIT`, MySQL conditional comments and the SQLite `sqlite_sequence` table are counted in one info gap (`dialect-noise-ignored`) when a dialect was recognised. Views, functions, triggers and non-enum types are reported as `unsupported-statement`.
- **Generated columns, CHECK, partitions.** Generated columns and `CHECK` constraints are tolerated; `PARTITION OF` and `LIKE` tables are reported.

Dialect support matrix:

| Input | Detected by | Read | Reported or limited |
| --- | --- | --- | --- |
| Plain SQL | no dialect markers | tables, keys, types | writes, views, indexes, triggers as before; no dialect gaps |
| PostgreSQL `pg_dump` (schema-only or with data) | `pg_catalog`, `ALTER TABLE ONLY`, `OWNER TO`, `CREATE SEQUENCE`, `nextval(`, `COPY ... FROM stdin`, enum types | `public.` names, ALTER constraints, enums, `$$` function bodies skipped, `E'..'` strings | COPY rows skipped (count only), jsonb and arrays as text with a gap, `sqlite-backend-only` |
| SQLite `.schema` / `.dump` | `AUTOINCREMENT`, `WITHOUT ROWID`, `STRICT`, `sqlite_sequence`, `PRAGMA` | all quoting styles, typeless columns, `WITHOUT ROWID`, `STRICT` | `sqlite_sequence` skipped; the native backend, so no backend caveat |
| MySQL `mysqldump --no-data` | `ENGINE=`, `AUTO_INCREMENT`, `/*!40101`, `UNIQUE KEY`, `LOCK TABLES` | backticks, `AUTO_INCREMENT`, inline `KEY` / `UNIQUE KEY` / `CONSTRAINT ... FOREIGN KEY`, `enum(...)`, backslash escapes | table options ignored, `sqlite-backend-only` |
| Markers of two dialects | both | read as generic SQL | `dialect-ambiguous` (warn); nothing is guessed |

**SQLite only.** The generated sql server reads a SQLite database file, read-only (`<NAME>_DB_PATH`). A schema folded from PostgreSQL or MySQL (or Prisma) only describes tables: the author must provide a SQLite file with the same tables and columns. This is reported as the info gap `sqlite-backend-only`.

INSERT/UPDATE/DELETE/DROP/TRUNCATE and unreadable ALTERs are ignored and recorded in the report as dropped writes; views, functions and triggers are reported as unsupported.

### prisma

A Prisma `schema.prisma` (D-546..D-548), read by hand, no Prisma tooling: `model` blocks become tables (the `@@map` name when present), scalar fields become columns (the `@map` name when present), `?` marks optional, `@id` and `@@id([a, b])` give the identifier, `@unique` and `@@unique` a note on the field, `@relation(fields: [..], references: [..])` a foreign key, `enum` blocks the allowed values (with `@map`). `String`, `Boolean`, `Int`, `BigInt`, `Float`, `Decimal`, `DateTime` map to integer, number, boolean or string; `Json`, `Bytes`, `Unsupported(...)` and list fields (`String[]`) become string with an `unsupported-type` gap; fields that point at another model are not columns (one info gap, `relation-fields-skipped`). `datasource` and `generator` blocks are skipped without reading them: no provider, no URL, no `env("...")` name reaches the model, the report or the generated code (info gap `config-blocks-ignored`). `@default(...)` values and `@db.*` native types are never read. A literal connection URL with credentials is rejected by the credential scan before the adapter runs, like any other input. `view`, `type` and `@@ignore` are reported. The generated backend is the same read-only SQLite file (`sqlite-backend-only`).

Auto-detection: text with `model Name {` at the start of a line (and no `CREATE TABLE` statement at a line start) is Prisma; SQL wins whenever a `CREATE TABLE` statement is present, and the sql-ddl adapter then reports `ambiguous-input` when the text also looks like Prisma (force `--adapter prisma` to override).

### odata

OData `$metadata` documents (D-561..D-572): **CSDL JSON** (OData 4.0 and 4.01: `$Version`, `$EntityContainer`, `EntityType` with `$Key`, properties, navigation properties, entity sets) and **EDMX XML** (4.0 and 4.01). The generated server is an HTTP server like the `openapi` ones; GET only.

- **Tools.** Per entity set a `list_<entities>` tool (`page`, `page_size`, optional `field`/`value`/`match`, `fields`) and, when the key is usable, a `lookup_<entity>_by_<key>` tool (one argument per key property, composite keys supported). Paging is `$top` and `$skip` (`$skip = (page - 1) * page_size`); the page size is clamped (default maximum 100 unless `--max-page-size`), the result ceiling warning works as for REST, and `@odata.nextLink` is never followed (`odata-nextlink-not-followed`).
- **Filters.** One field per call, compiled by fixed generated helpers into `$filter`: `equals` (`Name eq 'x'`), `contains` and `startsWith` (text fields only: `contains(Name,'x')`, `startswith(Name,'x')`). Values are checked against the declared type and only then written as an OData literal: text in single quotes with `'` doubled (control characters rejected, 256 characters at most), GUIDs, dates (`2026-01-31`), date-times with offset, times of day, booleans and numbers unquoted after a pattern check, enum members as `Namespace.Type'Member'` from the declared member list. An unknown or unfilterable field, an invalid value or a text mode on a non-text field is a structured `invalid_argument` error before any request is made. `Capabilities.FilterRestrictions` (`Filterable`, `NonFilterableProperties`) is honoured. Key values use the same literals (`/Parts(OrderID=7,LineNumber=2)`, `/Suppliers('A%2F1')`). The query string is percent-encoded by the generated code (spaces as `%20`, `$` kept in option names).
- **Projection.** `$select` carries the projection (at most 12 fields, as everywhere). `$expand` is never used; navigation properties are reported (`odata-navigation-not-expanded`).
- **Types.** `Edm.String`, `Guid`, `Date`, `DateTimeOffset`, `TimeOfDay` become text; `Boolean` boolean; `Byte`, `SByte`, `Int16`, `Int32` integer; `Single`, `Double` number; `Int64` and `Decimal` text (no precision loss, `odata-precision-as-string`; filters still use number literals); enum types text with the member list; complex and collection properties are returned as they come but cannot be filtered; `Edm.Binary`, `Edm.Stream` and geospatial properties are left out (`unsupported-type`).
- **Not exposed, reported.** Actions (writes: listed as dropped, `write-dropped`), functions (`odata-function-unsupported`; unbound functions are not called even when they look harmless), singletons (`odata-singleton-unsupported`), derived types (flattened, `odata-derived-types-flattened`), open types, keys given by alias path (`odata-key-unsupported`), `edmx:Reference` and other external schema documents (never fetched, `external-reference-not-fetched`), `Annotations` blocks that target other elements (`odata-external-annotations-ignored`). Only `Core.Description`, `Capabilities.FilterRestrictions` and `Authorization.Authorizations` are read from inline annotations; the rest are counted (`odata-annotations-ignored`).
- **Auth.** An `Authorization.Authorizations` annotation on the container chooses: OAuth2 or OpenID Connect gives a supplied bearer token from `<PREFIX>_ACCESS_TOKEN` (D-521, `oauth2-flow-not-implemented`), HTTP bearer `<PREFIX>_TOKEN`, an API key in a header or query option `<PREFIX>_API_KEY`; HTTP basic and anything else is `auth-unsupported` and no credentials are sent. Without the annotation the server sends none. The base address is always `<PREFIX>_BASE_URL`; no URL from the document reaches the output.
- **OData V2 and V3** (`edmx` namespace `.../ado/2007/06/edmx`, schema namespaces `.../ado/20xx/edm`) are recognised and rejected with `odata-version-unsupported`; nothing is guessed. A JSON document without an OData 4.x `$Version` is rejected the same way.
- **XML safety (D-560).** The one XML dependency is `sax@1.6.1`, loaded with a dynamic `import()` only when EDMX text is parsed. Before the parser sees the text, a fail-closed pre-check rejects `<!DOCTYPE`, `<!ENTITY` and every other `<!` construct except comments and CDATA (`doctype-rejected`, `xml-markup-rejected`) and every processing instruction except a leading `<?xml ...?>` (`xml-pi-rejected`); entities are never defined, so none can expand. While parsing: nesting depth at most 32, 20,000 elements, 64 attributes per element, 4,096 characters per attribute value, 1,000,000 characters of text (`xml-depth-exceeded`, `xml-limit-exceeded`, `xml-malformed`). Metadata is also capped at 500 entity types, 5,000 schema members, 100 entity sets and 200 properties per entity. No file or URL named in the document is ever read.
- **Entry points.** XML parsing needs the lazy load, so the CLI and the API route call `runPipelineAsync` (library users: `await prepareInput(...)` before `parseInput`/`runPipeline`; without it EDMX input is rejected with `odata-xml-unavailable`). CSDL JSON needs no preparation.
- **Real metadata and the size cap.** The 262,144 byte input cap is unchanged. Real `$metadata` documents of large services (hundreds of entity types, long annotation blocks) are often 1 to 10 MB, so they do not fit; slice the document to the entity types you want or save a reduced copy. See E13.

```json
{
  "$Version": "4.01",
  "$EntityContainer": "Acme.Catalog.Container",
  "Acme.Catalog": {
    "Product": { "$Kind": "EntityType", "$Key": ["ID"], "ID": { "$Type": "Edm.Guid" }, "Name": {} },
    "Container": { "$Kind": "EntityContainer", "Products": { "$Collection": true, "$Type": "Acme.Catalog.Product" } }
  }
}
```

Auto-detection: XML whose root is `Edmx` in an OData EDMX namespace, or JSON with a `$Version` string and `$EntityContainer` or `$Reference` (0.95); a schema-only JSON with just `$Version` scores 0.5. A document that also looks like OpenAPI or Swagger is read as OData with the warn gap `ambiguous-input` (force `--adapter openapi` to read it the other way). The other adapters' detection is unchanged.

## Entry points

**CLI** (author tool, no flag needed):

```bash
npm run generate-mcp -- --adapter openapi spec.yaml --out ./my-server
```

Options: `--adapter <openapi|tabular-catalog|sql-ddl|prisma|odata|auto>`, `--out <dir>`, `--force` (allow a non-empty output directory), `--server-name`, `--max-page-size`, `--result-ceiling`. Exit codes: 0 generated, 2 rejected or failed (gaps printed, nothing written), 64 usage. The CLI reads only the given input file, refuses `.env*` file names and inputs over the size cap.

**API route** `POST /api/mcp-generate` (flag-gated). Request JSON: `{ "adapter": "auto"|id, "input": "<text>", "options": { serverName, allowWrite, limits: { maxPageSize, resultCeiling, maxResponseItems } } }`. Success: `200 application/zip` (header `x-mcp-gaps` carries the gap count). Failure: JSON `{ ok: false, message, gaps: [...] }` (`message` is the first gap's message, D-461) with 400 (bad request), 404 (flag off), 429 (too many requests from this client or too many simultaneous generations; body `{ message }` only, with `Retry-After`; limits `MCP_GENERATOR_RATE_MAX` default 20, `MCP_GENERATOR_RATE_WINDOW_SEC` default 600, `MCP_GENERATOR_MAX_CONCURRENT` default 2, `0` = unlimited, D-465), 413 (input over 262,144 bytes; the raw body is capped at twice that), 422 (rejected input or oversize output over 2,000,000 bytes, D-155). The route adds no authentication logic of its own, writes nothing, logs nothing and never echoes the input. Authentication: with `AUTH_ENABLED=true` the global request hook (`src/hooks.server.ts`) protects `/api/mcp-generate` like every other `/api/*` route (401 `{ message: 'Authentication required' }` without a session); confirmed by Ville 2026-10-14 (D-476). The generator is deterministic only: LLM-assisted synthesis stays deferred and the generated server does not depend on `@modelcontextprotocol/sdk` (D-475).

**Customize menu**: the "Generate MCP" item on an agent detail page opens a panel: paste text, pick an adapter (default auto-detect), generate, and the zip downloads. The pasted text is cleared after a successful download and nothing is stored in the browser.

### Proposal-assisted generation (data only)

`generate-mcp` also accepts a proposal file: `--proposals <file>` (strict, all or nothing) with `--proposals-lenient` (apply the valid ops, report the rest), `--validate-only` (run the gates and print a before/after review, write nothing), `--context-pack <dir>` with repeatable `--docs <path>` and `--samples <path>` (a directory an external agent session can read), and `--emit-proposal-schema <file>`. The proposal is data, never code, and the generator stays deterministic: same input plus same proposal file gives byte-identical output. `report.json` and the package README carry the sha256 of the proposal file, so a reviewer can see a package was proposal-assisted. Full reference: [mcp-generator-proposals.md](mcp-generator-proposals.md).

## Generated package layout

The zip contains one folder named after the server:

| File | Purpose |
| --- | --- |
| `server.py` | FastMCP stdio server, helpers and tools |
| `test_server.py` | pytest tests for the behaviour checklist against a stubbed upstream, temp CSV or temp SQLite |
| `requirements.txt` | pins (`fastmcp>=3.4,<5`, `httpx` for http backends only; verified on fastmcp 3.4.8 and 4.1.0 on 2026-10-14) |
| `README.generated.md` | env var table, run command, `.mcp.json` snippet with placeholders |
| `report.json` | tools emitted and dropped, gaps, assumptions, env vars |
| `mcptest-binding.json` | tool binding for the MCP test platform: suite check id or behaviour kind to emitted tool name, plus an `argMap` from the suite's argument names to this tool's parameter names (see below) |

Environment variable convention: `<NAME>_BASE_URL`, `<NAME>_API_KEY` or `<NAME>_TOKEN`, `<NAME>_DATA_PATH`, `<NAME>_DB_PATH`, where `<NAME>` derives from the server name. Documentation and snippets only ever contain placeholders such as `<ACME_PARTS_API_KEY>`.

## Behaviour checklist

Every generated server guarantees (RESEARCH-SYNTHESIS section 3.2; the generated pytest asserts each):

1. Task-oriented tool names (`list_*`, `search_*`, `lookup_<entity>_by_<id>`, `filter_<entity>_by_<field>`, `query_*`, `describe_*`), not raw operation ids.
2. Trimmed responses: at most 12 projected fields; a `fields` argument can narrow but not exceed 12.
3. Page-size clamp to the documented maximum (default 100 when unknown, with a gap).
4. Ceiling warning: a page beyond `limits.resultCeiling` returns a structured warning suggesting narrowing the query.
5. Honest not-found for single lookups.
6. Honest empty results with a message, never a bare empty envelope.
7. Structured errors (`ok`, `kind`, `message`, `hint`): no tracebacks, no upstream body, no exception text, no secrets.
8. Authentication failures name the environment variable, never its value.
9. Read-only by default: no write tools are emitted (D-143: an opt-in is recorded and reported but writes are not generated in this version).

Plus bounded retries on 429/5xx, response size caps and parameterised read-only SQL with allow-listed identifiers.

### Output schemas

Every tool is registered with an explicit `output_schema` (a JSON schema literal, `_OUTPUT_SCHEMAS`, chosen per tool shape: list, item or describe) and returns the same dict as before; FastMCP sends it as `structuredContent` and validates it against the schema. Each schema is an object with a required boolean `ok` and optional `kind`, `message`, `hint`, `warning`, so the structured error result still validates. The schemas derive from the tool kind only, never from spec text. Verified on FastMCP 3.4.8 and 4.1.0 with identical server code: a plain `-> dict` annotation only advertises a generic object schema, and an explicit `output_schema=` is advertised as given on both. The only version difference is on the client side: 4.1.0 renames `Tool.outputSchema` to `output_schema` (and the annotation fields to snake_case), so the generated tests read both spellings. No version-conditional server code is needed.

## Safety

- Schema or spec only. Credential-looking input (keys, bearer tokens, `?apiKey=` literals, `.env` content) is rejected rather than redacted; the finding records rule, line and kind, never the matched text (D-142).
- The credential scan runs in time linear in the input (long lines are scanned in overlapping windows), and it knows URL userinfo, JWTs, common vendor key shapes and `password`/`passwd`/`secret_key`-style assignments (D-220, D-221).
- Credentials are also checked on the way out: text copied from the source into descriptions is redacted, and every generated file is scanned again; a hit withholds the whole package with `credential-in-output` (file, line and kind only; D-222).
- Source text published in tool descriptions is labelled `Source note`, stripped of markup and of phrases that address a model, and reported with the `source-text-copied` and `source-text-flagged` gaps (D-223).
- Generated tools reject `.` and `..` as identifiers, write only validated numbers and identifiers into Python and SQL, and order every report and gap list by code unit (D-224, D-225, D-231).
- Generation makes no network call and has no persistence.
- Ambiguous or unsupported constructs become gaps; the affected tool is omitted, never guessed.
- Generated code never contains URLs, secrets or raw exception text, and docstring text is sanitised.
- Fixtures and docs use invented Acme names only.

## Not supported and reported

Docs-only inputs, row data (COPY blocks and INSERT values are skipped, never read), profile documents, repositories, composite inputs, Swagger versions other than 2.0, OData V2 and V3, OData actions and functions, OAuth2 flows (the token is supplied), external `$ref`, non-SQLite DSNs, spreadsheets, and write operations. Each produces a gap or report line, not a guess. LLM-assisted synthesis is deferred (D-159).

Known limitations of the current core:

- The sql and dataset planners ignore the model's `operations`: they emit only `describe_*` and one bounded `query_<entity>` per entity (the list/get operations of a DDL model are kept for fidelity but yield no separate lookup tool). Lookup by key or foreign key works through the query filter. The dataset backend emits the first entity only (gap `dataset-multiple-entities`).
- Derived tool kinds `schemaDiscovery` and `crossFieldSearch` are declared in the type but only `inMemoryFilter` is accepted from callers; derived filters are http-only.
- (Fixed in 14-07: SQL `ORDER BY` now uses every identifier column, so composite-key tables page deterministically.)

## Gap codes (openapi adapter)

Every gap carries a code, a severity (`error`, `warn`, `info`), a message and, for operation gaps, the operation id in `path`. Messages name locations and type words only, never values copied from the input.

| Code | Severity | Meaning | Tool |
| --- | --- | --- | --- |
| `missing-response-schema` | warn | no JSON response schema on a success status | omitted |
| `path-param-undocumented` | warn | a templated path parameter is not declared | omitted |
| `pagination-conflict` | warn | both page and offset style parameters | omitted |
| `ambiguous-response` | warn | several candidate result arrays | omitted |
| `oneof-merged` | info | a oneOf with a discriminator was merged into one field set | kept |
| `auth-operation-override` | warn | an operation declares its own security; the document-level scheme is used for every tool | kept |
| `example-schema-mismatch` | warn | a response example contradicts its own schema (a property the schema does not define, a wrong type, null where not nullable); the message names the property path and the type words, never the example value (D-463) | kept, generated from the schema |
| `oauth2-flow-not-implemented` | warn | the API uses OAuth2 or OpenID Connect; the server reads a token you supply from `<PREFIX>_ACCESS_TOKEN` (D-521) | kept |
| `auth-unsupported` | warn | only a scheme the server cannot send (for example HTTP basic) is declared; no credentials are sent | kept |
| `swagger2-body-param-ignored` | info | a GET in a Swagger 2.0 document declared a body or formData parameter | kept |
| `webhooks-ignored` | info | the document declares `webhooks` (3.1+); only `paths` are read (D-530) | kept |
| `json-schema-dialect-unsupported` | warn | `jsonSchemaDialect` names a dialect other than the OpenAPI base dialect or JSON Schema 2020-12; never fetched | kept |
| `multi-type-unsupported` | info | `type` lists several non-null types; the field type is `unknown` | kept |
| `ref-sibling-keywords-ignored` | info | a `$ref` has siblings other than annotations (for example `type` or `nullable`); they are not merged | kept |
| `schema-keyword-unsupported` | info | a schema uses keywords that are not read (`if`, `then`, `else`, `not`, `patternProperties`, `prefixItems`, `propertyNames`, `contains`, `dependentSchemas`, `unevaluatedItems`, `unevaluatedProperties`, `$dynamicRef`, `$recursiveRef`); the message names them | kept |
| `ref-anchor-unsupported` | warn | a `$ref` names an anchor or the whole document (only `#/...` pointers resolve) | omitted |
| `ref-unresolved`, `ref-depth-exceeded`, `external-ref-unsupported`, `schema-budget-exceeded`, `ambiguous-oneof` | warn | unresolvable, endless, external or too large schema composition; also reported for a path item `$ref` (the path is skipped) | omitted |
| `query-method-unsupported` | info | a path item has a `query` operation or `additionalOperations` (3.2); only GET is modelled | skipped |
| `querystring-param-unsupported` | info | a `querystring` parameter (3.2) is not exposed as an argument | kept |
| `unsupported-version` | error | not Swagger 2.0 and not OpenAPI 3.x (`swagger-2-unsupported` is no longer emitted) | rejected |

Environment variables of a generated HTTP server: `<PREFIX>_BASE_URL` always; plus one of `<PREFIX>_API_KEY` (API key), `<PREFIX>_TOKEN` (HTTP bearer) or `<PREFIX>_ACCESS_TOKEN` (OAuth2 or OpenID Connect). `<PREFIX>` is the upper-case server name.

The Phase 15 tester treats a planted defect that produces neither a gap nor an omitted tool as `SILENT_GUESS`; since D-463 the partial-spec case's stale example is reported, so the generator passes `gap_reported` for it.

## Gap codes (sql-ddl and prisma adapters)

Messages name tables, columns and type words only, never values from the input (row data, defaults, connection strings).

| Code | Severity | Meaning |
| --- | --- | --- |
| `data-rows-skipped` | info | N data lines in COPY blocks were skipped (count only) |
| `copy-block-unterminated` | warn | a COPY block has no `\.` line; the rest of the text was skipped as data |
| `sql-dialect-detected` | info | the input was recognised as pg_dump, SQLite or mysqldump output |
| `dialect-ambiguous` | warn | markers of two dialects; read as generic SQL |
| `sqlite-backend-only` | info | the generated server reads a SQLite file; supply one with the same tables and columns (pg_dump, mysqldump, Prisma input) |
| `dialect-noise-ignored` | info | N housekeeping statements (SET, COMMENT ON, GRANT, OWNER TO, sequences, indexes, DROP IF EXISTS, ALTER COLUMN defaults) were ignored |
| `statement-ignored` | warn / info | a write (INSERT, UPDATE, DELETE, DROP, ALTER that is not a constraint, TRUNCATE, GRANT) was ignored; INSERT/UPDATE/DELETE are info |
| `unsupported-statement` | warn / info | a view, function, trigger, non-enum type or other statement is not supported |
| `alter-target-missing` | warn | an ALTER TABLE constraint names a table that is not in the input |
| `unparsable-constraint` | warn | an ALTER TABLE or Prisma constraint could not be read or names a missing column |
| `duplicate-primary-key` | warn | a second primary key was added to a table that has one; it was ignored |
| `alter-may-hold-keys` | warn | a table has no primary key and an unreadable key-like ALTER TABLE statement on it may define one |
| `no-identifier` | warn | a table has no primary key; list and query only |
| `unsupported-type` | warn | jsonb, arrays, composite types, Prisma `Json`, `Bytes`, lists or `Unsupported(...)`; exposed as text |
| `unknown-type` | info | a type was not recognised; string was used |
| `fk-target-missing` | info | a foreign key points at a table that is not in the input |
| `unsafe-identifier` | warn | a table or column name has characters that cannot be used safely; it was left out |
| `unparsable-table`, `duplicate-column`, `duplicate-table`, `too-many-tables`, `no-tables` | warn / error | a table could not be read, was repeated, exceeded the cap of 100 tables or 200 columns, or nothing usable was found |
| `ambiguous-input` | warn | the text looks like both SQL and a Prisma schema |
| `config-blocks-ignored` | info | Prisma datasource and generator blocks were skipped without being read |
| `relation-fields-skipped` | info | Prisma relation fields are not columns |
| `unterminated-block` | warn | a Prisma block is not closed; it and the rest were skipped |

## Gap codes (odata adapter)

Messages name entity sets, types and property names (only ones that pass the identifier check), counts and type words, never values or URLs from the document.

| Code | Severity | Meaning |
| --- | --- | --- |
| `odata-version-unsupported` | error | OData V1, V2 or V3 metadata, or no OData 4.x version; rejected |
| `odata-version-detected` | info | the version and format that were read |
| `doctype-rejected` | error | the XML declares a DOCTYPE, entity or other markup declaration; rejected before parsing |
| `xml-markup-rejected`, `xml-pi-rejected` | error | an XML markup declaration or processing instruction other than the allowed ones; rejected |
| `xml-depth-exceeded`, `xml-limit-exceeded`, `xml-malformed` | error | an XML limit was exceeded or the text is not well formed |
| `odata-xml-unavailable` | error | EDMX parsed without the prepare step (library use only) |
| `odata-not-edmx`, `odata-not-metadata` | error | the XML root is not an OData EDMX element, or the text is neither XML nor a JSON object |
| `odata-too-large` | error | more than 500 entity types or 5,000 schema members |
| `no-entity-sets` | error | no entity container with entity sets |
| `too-many-entity-sets`, `odata-too-many-properties` | warn | the first 100 sets or 200 properties were read |
| `external-reference-not-fetched` | warn | `edmx:Reference` or `$Reference` documents are never fetched; types defined only there are unknown |
| `odata-type-unresolved` | warn | an entity set type, base type or property type is not defined in the document; it was left out |
| `unsupported-type` | warn | binary, stream or geospatial properties were left out |
| `odata-key-unsupported`, `no-identifier` | warn | no lookup tool: key by alias path, key property missing or not writable in a key predicate, or no key |
| `unsafe-identifier`, `duplicate-table` | warn | a name that cannot be used safely, or a repeated entity, was left out |
| `odata-container-unresolved`, `odata-multiple-containers` | warn | the first container was used |
| `odata-schema-skipped` | warn | a Schema in an unknown namespace was skipped |
| `oauth2-flow-not-implemented`, `auth-unsupported` | warn | OAuth2 token supplied by the author, or an unsupported scheme (basic): no credentials sent |
| `ambiguous-input` | warn | the document also looks like OpenAPI or Swagger |
| `odata-navigation-not-expanded`, `odata-derived-types-flattened`, `odata-open-type`, `odata-entity-renamed` | info | navigation properties not expanded, derived types flattened, open type, entity exposed under the set name |
| `odata-function-unsupported`, `odata-singleton-unsupported` | info | functions and singletons are not exposed; actions appear as `write-dropped` |
| `odata-precision-as-string`, `odata-nextlink-not-followed` | info | Int64 and Decimal as text; `@odata.nextLink` never followed |
| `odata-annotations-ignored`, `odata-external-annotations-ignored` | info | annotations that are not read or not applied |

Environment variables of a generated OData server: `<PREFIX>_BASE_URL`, plus `<PREFIX>_ACCESS_TOKEN` (OAuth2), `<PREFIX>_TOKEN` (bearer) or `<PREFIX>_API_KEY`, when the metadata declares authorization.

## Extension point for synthesized capability

A `DerivedTool` describes a tool the source does not expose but that can be built from what it does expose:

```ts
interface DerivedTool {
  id: string            // "<entity>.<field>"
  kind: 'inMemoryFilter' | 'schemaDiscovery' | 'crossFieldSearch'
  entity: string
  source: string        // nested collection field on the entity
  description: string
  origin: 'detected' | 'user'
}
```

**Structural detection rule** (RESEARCH-SYNTHESIS 3.1, domain-free): a response entity has a nested array of objects with key-like and value-like item fields (a `NestedCollection` with key fields), and no declared request parameter filters on the collection or its key fields. `detectDerivedTools(model)` then emits an `inMemoryFilter` derived tool with `origin: 'detected'`. Adapters only describe the nested collection in the `SourceModel`; they never emit tools.

**Kinds.** `inMemoryFilter` fetches up to a bounded number of candidate pages from the entity's list or search operation (`max_pages`, 1 to 10, default 5), filters the nested array locally by key (and optionally value) and returns the matches. `schemaDiscovery` and `crossFieldSearch` are reserved names; the core already emits `describe_*` itself for dataset and SQL backends.

**Coverage reporting contract.** A derived tool never silently under-reports: its result states `pages_scanned` and whether the scan was `truncated`, and an empty result carries the honest-empty message.

**Worked example** (library API, no core change):

```ts
import { generate } from '$lib/mcpgen/generate'
import { parseInput } from '$lib/mcpgen/registry'

const parsed = parseInput({ text: openapiText }, { adapterId: 'openapi' })
if (parsed.ok) {
  const result = generate(parsed.model, {}, [
    {
      id: 'part.features',
      kind: 'inMemoryFilter',
      entity: 'part',
      source: 'features',
      description: 'Find parts that have a matching feature entry.',
      origin: 'user',
    },
  ])
  // result.files: server.py gains filter_part_by_features(key, value=None, ..., max_pages=5)
}
```

The emitted Python (in outline): a plain function `filter_part_by_features` registered with `mcp.tool(fn)` that validates `key`, `value` and `max_pages`, loops over the list operation's pages up to `max_pages`, keeps items whose `features` array has an entry with the requested key (and value), projects at most 12 fields, and returns the matches with `pages_scanned`, `truncated` and a message or the structured error shape.

**Invalid derived rules** never break generation. A user rule with an unknown entity, a source that is not a nested collection, an unsupported kind, or a non-http backend is skipped and reported as gap `derived-invalid`; a duplicate id is `derived-duplicate` (info); a missing list or search operation is `derived-no-source`. Unrecognizable input to the pipeline yields `unrecognized-input`.

**Adding an InputAdapter.** Implement `InputAdapter` from `src/lib/mcpgen/types.ts` (`id`, `label`, `detect(input)` returning a 0..1 confidence and never throwing, `parse(input, options)` returning `{ model, gaps }` or `{ rejected }`), add one line to `src/lib/mcpgen/adapters/index.ts`, and add fixtures plus a golden test. The core (plan, emit, registry, pipeline) is untouched; `criteria.test.ts` fails if the core imports an adapter module.

## Reproducibility

Output is byte-identical for the same input: sorted zip entries, fixed 1980-01-01 timestamps, stable JSON. Golden files live in `src/lib/mcpgen/__golden__/`; update them deliberately with:

```bash
UPDATE_GOLDEN=1 npx vitest run src/lib/mcpgen
```

and review the diff.

## Relation to Phase 15

The generated `test_server.py` asserts the behaviour checklist against a stub, which makes it a seed set of cases for the Phase 15 test platform.

**Where the per-case binding lives (answer to the open question, synthesis section 6 Q7; decided in E10, D-502).** The suite names tools by regex hints (`^lookup_item$`, `^search_items$`), which a generated server never matches (`lookup_part_by_id`, `search_part`). The generator therefore emits `mcptest-binding.json` next to `server.py`, derived from the plan (`src/lib/mcpgen/binding.ts`, one function, deterministic):

```json
{
  "lookup_by_id": { "tool": "lookup_part_by_id", "argMap": { "id": "partId" } },
  "search_keyword": { "tool": "search_part", "argMap": { "query": "q", "per_page": "page_size" } }
}
```

Keys are suite check ids (`tool_exists_lookup`, `search_keyword`, ...) or behaviour kinds (`lookup_by_id`, `pagesize_clamp`, ...). `tool` is the explicit binding and wins over the regex hints; `argMap` renames the suite's argument names and keeps their values (a literal `args` object, if present, replaces the suite's arguments instead). Roles the plan has no tool for are omitted and the check reports `no tool`. The file holds tool and parameter names only, never values or secrets. The test platform's in-process generator subject reads this same emitted file, and the runner loads `<package>/mcptest-binding.json` for subjects that run a server from a package directory (`cmd:` and container). Roles are mapped from tool kinds (get, search, list, filter) by name and parameter shape; a server whose tools do not fit those kinds scores `no tool` for the roles it lacks, which is a finding, not a scorer fault.

## Design basis

- RESEARCH-SYNTHESIS section 3.1: the synthesize-what-the-source-lacks discriminator.
- RESEARCH-SYNTHESIS section 3.2: behaviour checklist.
- RESEARCH-SYNTHESIS section 4.1: unverified claims stay marked UNVERIFIED (FastMCP pin).
- RESEARCH-SYNTHESIS section 5.1 and 5.2: adapter set and core/adapter interface.
- RESEARCH-SYNTHESIS section 5.3: deterministic first, LLM-assisted deferred.
- RESEARCH-SYNTHESIS section 5.4: safety invariants.
- RESEARCH-SYNTHESIS section 5.5 and 6: Phase 15 reuse and open questions.
