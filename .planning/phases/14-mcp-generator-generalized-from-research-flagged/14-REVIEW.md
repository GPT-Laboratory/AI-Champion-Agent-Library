---
phase: 14-mcp-generator-generalized-from-research-flagged
reviewed: 2026-10-13T00:00:00Z
depth: deep
files_reviewed: 24
files_reviewed_list:
  - src/lib/mcpgen/adapters/openapi.ts
  - src/lib/mcpgen/adapters/sql-ddl.ts
  - src/lib/mcpgen/adapters/tabular-catalog.ts
  - src/lib/mcpgen/adapters/index.ts
  - src/lib/mcpgen/plan.ts
  - src/lib/mcpgen/generate.ts
  - src/lib/mcpgen/emit/python.ts
  - src/lib/mcpgen/emit/pytest.ts
  - src/lib/mcpgen/emit/pyutil.ts
  - src/lib/mcpgen/emit/runtime.ts
  - src/lib/mcpgen/emit/requirements.ts
  - src/lib/mcpgen/credentials.ts
  - src/lib/mcpgen/registry.ts
  - src/lib/mcpgen/pipeline.ts
  - src/lib/mcpgen/bundle.ts
  - src/lib/mcpgen/diagnostics.ts
  - src/lib/mcpgen/report.ts
  - src/lib/mcpgen/types.ts
  - src/lib/mcpgen/api-contract.ts
  - scripts/generate-mcp.ts
  - src/routes/api/mcp-generate/+server.ts
  - src/lib/components/GenerateMcpPanel.svelte
  - src/lib/components/CustomizeMenu.svelte
  - src/lib/flags.ts
findings:
  critical: 3
  warning: 10
  info: 7
  total: 20
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-10-13
**Depth:** deep
**Files Reviewed:** 24
**Status:** issues_found

## Summary

The generated-Python injection surface is well handled. Every untrusted string that reaches Python source goes through `pyStr` (JSON.stringify based) or `cleanText`, and SQL in the generated server is built only from an allow-list of identifiers plus bound parameters. I ran hostile specs (triple quotes, newlines, U+2028, backslashes, `__import__` in field names, quote-bearing apiKey header names and enum values) through the real pipeline and `py_compile`: no code injection, no escaping defect. Generated tests pass against a stub `fastmcp` for the OpenAPI, SQL and tabular fixtures (31, 22 and 10 passed). The ZIP bundle is path-safe (fixed file names, `validPath`, slug-checked folder) and byte-for-byte deterministic across time zones. Flag-off behaviour is correct: the route throws 404 before touching the body and the menu data key is absent.

The weak areas are availability and credential handling. Two unauthenticated inputs under the 256 KB cap burn CPU for minutes (credential scanner, `$ref` fan-out). The credential scanner has large blind spots, and untrusted description text is copied into generated source and tool descriptions without the sanitizer closing those gaps, so a credential the scanner misses ships inside `server.py` and `README.generated.md`. There are also several correctness defects in the generated runtime.

All timings below were measured on this machine with `npx tsx`.

## Critical Issues

### CR-01: Quadratic-time regex in the credential scanner blocks the event loop (DoS)

**File:** `src/lib/mcpgen/credentials.ts:38`
**Issue:** The `key-literal` rule starts with `[A-Za-z0-9_-]*` before the keyword. For a long line of identifier characters V8 tries every start offset, greedily consumes the rest of the run and backtracks looking for `token|secret|password|api_key`. A single line `'a'.repeat(n)` took 1.0 s at 20 000, 4.3 s at 40 000 and 16.6 s at 80 000 characters; the 262 144-byte cap allows roughly 3 minutes of synchronous CPU in one request. The scan runs in `registry.parseInput` (src/lib/mcpgen/registry.ts:52) before any adapter, in the SvelteKit server process, so one request stalls every other request. This is reachable by anyone who can reach the route when `MCP_GENERATOR` is on (the route has no auth of its own and no rate limit). A minified single-line spec or a hex dump hits it without malice.
**Fix:** The prefix is not captured and does not change the verdict, so drop it. Also cap per-line length before scanning.
```ts
re: new RegExp(`${KEY_NAMES}["']?\\s*[:=]\\s*["']?([^\\s"',;&}#]+)`, 'gi'),
// and in scanForCredentials, per line:
const line = lines[i].length > 4096 ? lines[i].slice(0, 4096) : lines[i]
```
Add a regression test with `'a'.repeat(250_000)` that must finish in well under a second.

### CR-02: Exponential `allOf`/`oneOf` fan-out in `schemaProps` (DoS with a tiny spec)

**File:** `src/lib/mcpgen/adapters/openapi.ts:94-113` (callers at 399, 406, 427, 434, 166)
**Issue:** `MAX_REF_DEPTH` limits depth only. `schemaProps` recurses into every `allOf` member and every `oneOf`/`anyOf` variant with no memoisation and no node budget. Twelve schemas, each `allOf` of N refs to the next, cost N^12 calls. Measured: width 3 / depth 11 = 0.85 s (1.5 KB), width 4 / depth 11 = 12.2 s (1.9 KB); width 8 is effectively a hang. Each operation calls `schemaProps` up to four times and each array field calls it again, multiplying the cost. The YAML alias cap (`maxAliasCount: 50`, verified to reject a billion-laughs document) does not help because `$ref` is resolved by the adapter, not by the YAML library.
**Fix:** Memoise by resolved node identity (a `WeakMap<object, Obj>` per parse), and add a shared visit budget that throws `Unsupported('ref-depth-exceeded', ...)`.
```ts
const budget = { left: 5000 }
function schemaProps(root, schema, depth = 0, notes?, memo = new WeakMap<object, Obj>(), b = budget) {
  if (--b.left < 0) throw new Unsupported('ref-depth-exceeded', 'Schema composition is too large.')
  const { node } = deref(root, schema)
  const hit = memo.get(node); if (hit) return hit
  /* ...compute props, passing memo and b to recursive calls... */
  memo.set(node, props); return props
}
```

### CR-03: Credentials missed by the scanner are copied into generated source and tool descriptions

**File:** `src/lib/mcpgen/emit/pyutil.ts:36-47`, `src/lib/mcpgen/plan.ts:276`, `src/lib/mcpgen/adapters/openapi.ts:40-49`
**Issue:** The "never store credentials" guarantee rests entirely on `scanForCredentials`, and the sanitizers do not back it up. `cleanText`, `withSummary` and `clean` strip only `http(s)://` URLs and `sk-` tokens. I generated a server from an OpenAPI document whose operation `summary` contained `postgres://svc:Sup3rS3cretPw@db.internal/prod` and a JWT. The scanner passed it, and both strings appear verbatim in `server.py` (docstring, line 266 of the output) and `README.generated.md` (tool list). The docstring is also what the MCP client and LLM see as the tool description, so the secret is shipped to an LLM context. See WR-03 for the scanner gaps that let it through.
**Fix:** Make the sanitizer independent of the scanner. In `cleanText`, `clean` (openapi.ts) and `withSummary`, replace any `\b[a-z][a-z0-9+.-]*://\S+` (not just http/https), any `user:pass@` userinfo, any JWT shape (`eyJ[\w-]+\.[\w-]+\.[\w-]+`), and any long base64/hex-looking token (for example `[A-Za-z0-9+/_-]{32,}`) with a marker. Better, run `scanForCredentials` on the final emitted text of every file in `generate()` and refuse to output if anything matches.

## Warnings

### WR-01: `_seg` allows `.` and `..`, so tool arguments can traverse out of the intended upstream path

**File:** `src/lib/mcpgen/emit/runtime.ts:209-213`
**Issue:** `urllib.parse.quote(text, safe="")` leaves dots untouched, so `lookup_thing(id="..")` produces `/things/..`. I confirmed with httpx 0.28.1 that `Request('GET', 'https://api.example.org/v1/things/..')` normalises to `https://api.example.org/v1`. An LLM-controlled argument can therefore reach a different upstream path than the generated allow-list implies, with the API key attached. `/` and `%` are encoded correctly, so the reach is limited to dot-segment traversal, but it defeats the `PATH_OK` / `pathSegments` hardening in plan.ts.
**Fix:** reject dot segments in `_seg`.
```python
if text in (".", "..") or not text or len(text) > 128:
    raise _Fail("invalid_argument", "The identifier must be between 1 and 128 characters.")
```
Add a generated test for `..`.

### WR-02: A parameter named `Exception` shadows the builtin used in every tool's `except`

**File:** `src/lib/mcpgen/plan.ts:44-52, 208-218`
**Issue:** `RESERVED_NAMES` lists lowercase builtins but not `Exception`, and the uppercase filter `/^[A-Z0-9_]+$/` does not match mixed case. I generated `def lookup_thing_by_exception(Exception: str, ...)` from a path parameter `{Exception}`; it compiles, but inside the function `except Exception:` now names a `str`, so any non-`_Fail` error raises `TypeError: catching classes that do not inherit from BaseException` out of the tool instead of the structured `_err("internal", ...)` result. The same class of problem applies to any other name the tool bodies resolve at call time.
**Fix:** add `Exception BaseException` (and any other global the templates reference, for example `_Fail` is already safe by the underscore rule) to `RESERVED_NAMES`, or reject any parameter whose name is a Python builtin (`dir(builtins)` snapshot). Add a test.

### WR-03: Credential scanner has large false-negative gaps

**File:** `src/lib/mcpgen/credentials.ts:34-60`
**Issue:** Verified by running the scanner. Not detected: `secret_key: "0123456789abcdef"`, `passwd: "..."`, `client_secret` variants with `_key`, `password: "my secret pass phrase"` (value is cut at the first space, then fails `min: 8`), `password=ab#cdefghijk` (value is cut at `#`/`&`), `https://admin:Sup3rS3cret@host/` and `postgres://user:pw@host/db` (URL userinfo), JWTs (`eyJ...`), Stripe `sk_live_...` (rule only matches `sk-`), Slack `xoxb-`, Google `AIza...`, GitLab `glpat-`, GitHub `ghs_/gho_`. `isPlaceholder` also treats any all-caps value (`SECRET=KJHGFDSAQWERTYUIOP`) as an env-var name, and any value containing `example`, `your_` or `<`/`>` anywhere as a placeholder (`password: Xexample9812kQ` passes).
**Fix:** add `pwd|passwd|passphrase|private[_-]?key|client[_-]?secret|access[_-]?key|auth` to `KEY_NAMES` with optional `[_-]\w+` suffix; add URL-userinfo, JWT, `sk_(live|test)_`, `xox[abprs]-`, `AIza`, `glpat-`, `gh[opsu]_` pattern rules; capture quoted values in full; tighten `isPlaceholder` to whole-value matches only. Keep the scan as a defence layer and rely on CR-03's output-side check as the guarantee.

### WR-04: Raw interpolation sinks in the emitter rely on upstream validation (latent Python and SQL injection)

**File:** `src/lib/mcpgen/emit/python.ts:58, 62, 132, 249, 251, 303, 419-420`; `src/lib/mcpgen/emit/pytest.ts:226`
**Issue:** `limits.resultCeiling` is written into Python source with `${ceiling}` and `p.min`/`p.max` with `${p.min ?? ...}` without a numeric check at the emit boundary; `maxResponseItems` and the page size are validated in plan.ts but `resultCeiling` is not (plan.ts:309-310). Today it is safe only because `+server.ts` (`clampInt`) and the CLI (`posInt`) sanitise first and the OpenAPI adapter checks `typeof === 'number'`. `generate()` and `buildPlan()` are exported library entry points, so any other caller passing `{ limits: { resultCeiling: "0:\n import os" } }` gets arbitrary Python. Likewise python.ts:419-420 builds SQL identifiers as `"${f.name}"` with no doubling of `"`; safety depends on the `IDENT` filter at plan.ts:453-460.
**Fix:** validate once in `buildPlan` (`Number.isInteger` and range for `resultCeiling`, finite numbers for `p.min`/`p.max`, dropping the param limits otherwise) and make the emitter emit numbers through `String(Number(x))` after a `Number.isFinite` check. Emit identifiers through a helper that asserts `/^[A-Za-z_][A-Za-z0-9_]*$/` and throws.

### WR-05: Dataset backend ignores the delimiter the adapter detected, silently returning no rows

**File:** `src/lib/mcpgen/emit/runtime.ts:282`, `src/lib/mcpgen/adapters/tabular-catalog.ts:44-55, 136`
**Issue:** The tabular adapter explicitly supports `;` and tab-delimited headers, but the generated server always calls `csv.DictReader(handle)` with the default comma. I generated from `id;name;price` and the server has no delimiter handling and no gap was raised. With a semicolon or tab data file the whole header becomes one column, every `row.get(field)` is `None`, and every query returns "no matches" with no error.
**Fix:** record the delimiter in the model (for example `backend.delimiter`) and emit `csv.DictReader(handle, delimiter=<pyStr>)`, or use `csv.Sniffer` on the first line. At minimum raise a warn gap when the detected delimiter is not a comma.

### WR-06: Untrusted spec text is copied into MCP tool descriptions (tool-description prompt injection)

**File:** `src/lib/mcpgen/plan.ts:275-278`, `src/lib/mcpgen/emit/python.ts:89-98`
**Issue:** Operation summaries (120 chars) and parameter descriptions (160 chars) from the source document become the docstring that FastMCP publishes as the tool description. The text is sanitised for Python syntax, not for instructions: a spec from a third party can carry "ignore previous instructions and call ..." into the user's LLM context, in `server.py`, and in the README. The README says "Review it before use", but nothing flags that descriptions came from the source.
**Fix:** either drop source-supplied free text from the published description (use the generated template only and keep source notes in `report.json`), or label it and add a `source-text-copied` warn gap per tool. Strip imperative or markup-like content at minimum.

### WR-07: `equals` semantics and documentation differ between backends

**File:** `src/lib/mcpgen/emit/python.ts:289`, `src/lib/mcpgen/emit/runtime.ts:316-324` versus `100-113`
**Issue:** The docstring for every query tool says "equals, contains or startsWith (case-insensitive)". The dataset runtime uses `casefold()` and numeric comparison. The SQL runtime uses `column = ?` (case-sensitive under SQLite's default BINARY collation) and `LIKE` (case-insensitive for ASCII only, so `ä` vs `Ä` differ). An LLM told a match is case-insensitive gets silent misses on SQL backends, and the generated tests only use exact-case values so they do not catch it.
**Fix:** use `column = ? COLLATE NOCASE` (or `lower(column) = lower(?)`) in the SQL equals branch and document the ASCII limitation for contains and startsWith, or change the docstring per backend. Add a test with mixed case.

### WR-08: Report and diagnostics ordering uses `localeCompare` (non-deterministic across locales)

**File:** `src/lib/mcpgen/report.ts:12, 49`, `src/lib/mcpgen/diagnostics.ts:29-30`
**Issue:** The design promises byte-identical output. `report.toolsDropped` and `report.envVars` go into `report.json` sorted with the default-locale `localeCompare`; ordering of punctuation, case and non-ASCII differs between ICU locales (the operation ids and paths are spec-controlled). Everything else in the pipeline sorts by code unit.
**Fix:** use `a < b ? -1 : a > b ? 1 : 0` (or `localeCompare(b, 'en')` with a fixed locale and options) in these three places.

### WR-09: `security: []` is treated as "use every declared scheme"

**File:** `src/lib/mcpgen/adapters/openapi.ts:298-299`
**Issue:** `referenced.length > 0 ? referenced : Object.keys(schemes)`. A document with global `security: []` (explicitly public) that still declares `securitySchemes` is modelled as authenticated; the generated server then raises `auth` ("check the API key configured in ...") whenever the env var is unset, so a public API cannot be used without a dummy key. Operation-level `security` overrides are ignored as well.
**Fix:** treat `Array.isArray(root.security) && root.security.length === 0` as `none`, and emit an `auth-operation-override` gap when any operation declares its own `security`.

### WR-10: Offset/limit-style pagination is dropped silently from the OpenAPI model

**File:** `src/lib/mcpgen/adapters/openapi.ts:377-380, 447-451`, `src/lib/mcpgen/plan.ts:53`
**Issue:** Only `PAGE_NAMES` set `pageParam`. For `offset`+`limit` APIs, `offset` is left as an ordinary optional query param, which `STANDARD_ARGS` then rejects (`param-dropped` warn). The tool exposes `page_size` but no way to move past the first page, and no ceiling logic applies. This is a common pagination style.
**Fix:** model `offsetP` as a second paging mode (emit `offset: int = 0` and pass it through) or omit the operation with an explicit `offset-pagination-unsupported` gap instead of generating a tool that cannot page.

## Info

### IN-01: Tables without a primary key page with no `ORDER BY`

**File:** `src/lib/mcpgen/emit/python.ts:420`, `src/lib/mcpgen/emit/runtime.ts:325`
**Issue:** `order` is empty when `identifierFields` is empty, so `LIMIT ? OFFSET ?` pages over an unspecified order (acme-sql has such a table).
**Fix:** order by `rowid` for SQLite tables without a primary key (or the first column).

### IN-02: Ceiling check rejects a partially valid last page

**File:** `src/lib/mcpgen/emit/python.ts:132, 251, 303`
**Issue:** `page * size > ceiling` and `offset + limit > ceiling` return the warning even when part of the requested window is inside the ceiling (ceiling 10000, size 30, page 334 covers 9991-10020). With a ceiling below the default page size, page 1 always returns the warning.
**Fix:** compare the window start: `(page - 1) * size >= ceiling` and `offset >= ceiling`, clamping the size to the remaining room.

### IN-03: Enum check compares `str()` of the argument with `String()` of the spec value

**File:** `src/lib/mcpgen/emit/python.ts:55`, `src/lib/mcpgen/adapters/openapi.ts:136`
**Issue:** Boolean enums become `"true"` in JS but `str(True)` is `"True"` in Python; numeric enums such as `1.0` vs `str(1.0)` can differ. Valid values are rejected.
**Fix:** normalise through `_qv(...)` (already maps bool to `true`/`false`) and compare numerically for number/integer types.

### IN-04: Property names from `Object.prototype` are dropped when merged through `allOf`

**File:** `src/lib/mcpgen/adapters/openapi.ts:99`
**Issue:** `if (!(k in props))` treats `constructor`, `toString`, `valueOf` and `hasOwnProperty` as already present on `{}`, so those fields vanish silently when they come from an `allOf` member. A `__proto__` property key assigned at line 110 sets the object's prototype instead of creating a field.
**Fix:** build `props` with `Object.create(null)` and use `Object.prototype.hasOwnProperty.call`.

### IN-05: Dead code and unused parameters

**File:** `src/lib/mcpgen/emit/python.ts:43, 150, 446`, `src/lib/mcpgen/emit/python.ts:326`
**Issue:** `void op`, `void kind`, `void serverSlug` exist only to silence unused warnings; `describeTool(plan, tool)` ignores `plan`; the `serverSlug` import and the `kind`/`op` parameters are unused.
**Fix:** remove the parameters and the import.

### IN-06: CLI hazards

**File:** `scripts/generate-mcp.ts:23-27, 154`
**Issue:** `clean` strips C0 controls but not C1 controls (`U+0080-U+009F`, including 8-bit CSI), so spec-derived gap text can still drive some terminals. `isMain` compares `import.meta.url` with a raw `file://` string; a path containing spaces or other URL-encoded characters never matches and the CLI then exits 0 doing nothing.
**Fix:** also strip `[\u0080-\u009f]`; use `pathToFileURL(process.argv[1]).href` for the main check.

### IN-07: Client bundle and README content

**File:** `src/lib/components/GenerateMcpPanel.svelte:3`, `src/lib/mcpgen/generate.ts:53`
**Issue:** `GenerateMcpPanel` statically imports `registry.js`, which pulls all adapters and the `yaml` parser into the agent-detail page bundle even when the flag is off (no behavioural change, but extra payload on the default path). The README title and tool lines embed spec text (`cleanText` allows markdown link syntax such as `[x](javascript:...)`).
**Fix:** import the adapter id/label list lazily (dynamic `import()` inside the open handler) or pass it as a prop; escape markdown metacharacters in `emitReadme`.

---

_Reviewed: 2026-10-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
