---
phase: 14-mcp-generator-generalized-from-research-flagged
fixed_at: 2026-10-13T00:00:00Z
review_path: .planning/phases/14-mcp-generator-generalized-from-research-flagged/14-REVIEW.md
iteration: 1
findings_in_scope: 18
fixed: 18
skipped: 0
status: all_fixed
---

# Phase 14: Code Review Fix Report

**Fixed at:** 2026-10-13
**Source review:** `.planning/phases/14-mcp-generator-generalized-from-research-flagged/14-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 18 (CR-01..03, WR-01..10, and the trivial Info findings IN-01, IN-04, IN-05, IN-06 and the README part of IN-07)
- Fixed: 18 (all 13 critical and warning findings plus 5 Info findings; IN-02, IN-03 and the bundle half of IN-07 were left out on purpose, see Skipped)
- Skipped: 0 of the in-scope findings

Where verification ran: the dedicated worktree branch `worktree-agent-a689bb23cbc195d16` (a harness-created isolated worktree, reset to `autonomous/overnight-improvements` first), with `npm ci`, `db:push`, `ingest` and `tryout:configure` run there. Final gate `npm run check` (svelte-kit sync, tsc, full vitest run: 183 files, 1887 tests) exited 0. The generated Python was never executed; it is only compiled by the existing guarded `python3 -I -m py_compile` helper (new variants added in `emit/hardening.test.ts`). Logic findings (marked below) pass static and unit checks but their generated runtime behaviour was reviewed by reading only, so they are flagged for human verification.

All fixes are covered by NEW test files; no pre-existing test file was edited. Golden files changed in one dedicated commit (see "Golden files").

## Fixed Issues

### CR-01: Quadratic-time regex in the credential scanner (DoS)

**Files modified:** `src/lib/mcpgen/credentials.ts`
**Tests:** `src/lib/mcpgen/credentials.hardening.test.ts` (13 adversarial 250 000 character shapes, each under 1.5 s; a spec padded to the size cap; secrets far beyond the first window and across a window boundary are still found)
**Commit:** 4b4c1dd
**Applied fix:** The regex rules were replaced by bounded hand scanning (one keyword alternation, then fixed look-ahead; prefix tokens, JWT, URL userinfo and PEM markers via `indexOf` with run skipping). The review's per-line truncation was not used because it would hide a secret late in a minified one-line spec; lines longer than 8192 characters are scanned in overlapping windows instead (D-220). Status: fixed.

### CR-02: Exponential `allOf`/`oneOf` fan-out in `schemaProps`

**Files modified:** `src/lib/mcpgen/adapters/openapi.ts`
**Tests:** `src/lib/mcpgen/adapters/openapi.budget.test.ts` (allOf width 4 and 8 depth 11, oneOf width 6 depth 11 all read in well under 2 s; an over-budget composition gives `schema-budget-exceeded` and omits only that operation; cyclic allOf still gives `ref-depth-exceeded`)
**Commit:** abce4d2
**Applied fix:** Memoisation of merged properties per resolved node (WeakMap per parse) plus a call budget of 5000 per operation and 200 000 per document; exceeding it reports the new gap `schema-budget-exceeded` (D-226). Status: fixed.

### CR-03: Credentials missed by the scanner copied into generated source and descriptions

**Files modified:** `src/lib/mcpgen/redact.ts` (new), `src/lib/mcpgen/emit/pyutil.ts`, `src/lib/mcpgen/adapters/openapi.ts`, `src/lib/mcpgen/plan.ts`, `src/lib/mcpgen/generate.ts`, `src/lib/mcpgen/emit/python.ts`
**Tests:** `src/lib/mcpgen/sanitize.test.ts` (db url, https userinfo, JWT, vendor key, hex digest, base64 blob, key assignments are removed from `cleanText` output; none of them reaches any generated file; a unicode-escaped `password` that bypasses the input scan is neutralised; a credential placed where text is emitted verbatim makes `generate` return no files and a `credential-in-output` gap with file and line only)
**Commit:** 9023aea
**Applied fix:** `redactSecrets` is applied in `cleanText`, the OpenAPI `clean` and the operation summary, replaces links of any scheme, userinfo, JWTs, vendor tokens and long mixed tokens, and fails closed to `[removed]`; `generate()` re-scans every emitted file and withholds the package on a hit (D-222). Status: fixed.

### WR-01: `_seg` allows `.` and `..`

**Files modified:** `src/lib/mcpgen/emit/runtime.ts`, `src/lib/mcpgen/emit/pytest.ts`
**Tests:** `src/lib/mcpgen/emit/hardening.test.ts` (runtime text, generated `test_dot_segment_identifiers_are_rejected_before_any_call`, py_compile)
**Commit:** 1dd71a2
**Applied fix:** `_seg` rejects `.` and `..` after trimming (D-224). Status: fixed: requires human verification (the generated test has not been run; the repository never executes generated Python).

### WR-02: A parameter named `Exception` shadows the builtin

**Files modified:** `src/lib/mcpgen/plan.ts`
**Tests:** `src/lib/mcpgen/emit/hardening.test.ts` (eleven names dropped or omitted; `id` stays allowed)
**Commit:** 1dd71a2
**Applied fix:** `Exception` and `BaseException` are reserved names. Not all builtins: `id` and similar are common API argument names (D-225). Status: fixed.

### WR-03: Credential scanner false negatives

**Files modified:** `src/lib/mcpgen/credentials.ts`
**Tests:** `src/lib/mcpgen/credentials.hardening.test.ts` (22 formerly missed shapes flagged, 11 look-alikes still clean, no echo of matched text, per-line reporting)
**Commit:** 4b4c1dd
**Applied fix:** New key names and suffixes, full quoted values, `#` in values, URL userinfo, JWT, payment, Slack, Google, GitLab and GitHub shapes, AWS temporary keys, whole-value placeholder matching. A bare `auth` key word was deliberately not added (D-221). Status: fixed: requires human verification (detection heuristics; the trade-off that quoted prose after `password:` is now rejected is a judgement call).

### WR-04: Raw interpolation sinks in the emitter

**Files modified:** `src/lib/mcpgen/plan.ts`, `src/lib/mcpgen/emit/python.ts`, `src/lib/mcpgen/emit/pytest.ts`, `src/lib/mcpgen/emit/pyutil.ts`
**Tests:** `src/lib/mcpgen/emit/hardening.test.ts` (hostile ceiling, page size, response items, parameter min/max never reach the output and are reported; `pyNum`, `pyIdent`, `sqlIdent` throw; emitter refuses a tampered plan; `__proto__` and `constructor` names; projection override on an entity named `constructor`)
**Commit:** 1dd71a2
**Applied fix:** Validation in `buildPlan` (gaps `limit-invalid`, `param-limit-invalid`) and checked helpers at every raw sink (D-225). Status: fixed.

### WR-05: Dataset backend ignores the detected delimiter

**Files modified:** `src/lib/mcpgen/types.ts`, `src/lib/mcpgen/adapters/tabular-catalog.ts`, `src/lib/mcpgen/plan.ts`, `src/lib/mcpgen/emit/python.ts`, `src/lib/mcpgen/emit/runtime.ts`, `src/lib/mcpgen/emit/pytest.ts`, `src/lib/mcpgen/report.ts`
**Tests:** `src/lib/mcpgen/emit/hardening.test.ts` (comma, semicolon, tab, invalid delimiter; adapter detection; generated test writer; report wording)
**Commit:** 1dd71a2
**Applied fix:** `backend.delimiter` -> `DATA_DELIMITER` -> `csv.DictReader(handle, delimiter=DATA_DELIMITER)`; info gap `delimiter-detected` (D-228). Status: fixed: requires human verification (generated reader not run).

### WR-06: Spec text becomes tool-description prompt injection

**Files modified:** `src/lib/mcpgen/redact.ts`, `src/lib/mcpgen/plan.ts`, `src/lib/mcpgen/emit/python.ts`, `src/lib/mcpgen/emit/pyutil.ts`
**Tests:** `src/lib/mcpgen/sanitize.test.ts` (phrases replaced and reported per tool, markup and links flattened, ordinary wording untouched, `source-text-copied` present for the sample)
**Commit:** 9023aea
**Applied fix:** `sanitizeSourceText` plus gaps `source-text-copied` and `source-text-flagged`; summaries stay labelled `Source note:` (D-223). Status: fixed: requires human verification (heuristic deny-list; cannot be complete).

### WR-07: `equals` semantics differ between backends

**Files modified:** `src/lib/mcpgen/emit/runtime.ts`, `src/lib/mcpgen/emit/python.ts`, `src/lib/mcpgen/emit/pytest.ts`
**Tests:** `src/lib/mcpgen/emit/hardening.test.ts` (NOCASE branch, per-backend docs, mixed-case test emitted for dataset and SQL)
**Commit:** 1dd71a2
**Applied fix:** `COLLATE NOCASE` on SQL equals; SQL docs say "case-insensitive for ASCII letters only" (D-229). Status: fixed: requires human verification (generated SQL not run).

### WR-08: `localeCompare` ordering

**Files modified:** `src/lib/mcpgen/diagnostics.ts`, `src/lib/mcpgen/report.ts`
**Tests:** `src/lib/mcpgen/ordering.test.ts` (code-unit order for `toolsDropped`, gap formatting, and a scan forbidding `localeCompare` in the generator modules)
**Commit:** f309b3b
**Applied fix:** `cmp` comparator (D-231). Status: fixed.

### WR-09: `security: []` treated as "use every declared scheme"

**Files modified:** `src/lib/mcpgen/adapters/openapi.ts`
**Tests:** `src/lib/mcpgen/adapters/openapi.security.test.ts`
**Commit:** 4a139e5
**Applied fix:** An empty document-level `security` list means no authentication (info gap `auth-public`); an operation-level `security` that differs from the document level is reported as `auth-operation-override` (D-230). Per-operation authentication is not generated. Status: fixed.

### WR-10: Offset/limit pagination dropped silently

**Files modified:** `src/lib/mcpgen/types.ts`, `src/lib/mcpgen/adapters/openapi.ts`, `src/lib/mcpgen/plan.ts`, `src/lib/mcpgen/emit/python.ts`, `src/lib/mcpgen/emit/pytest.ts`, `src/lib/mcpgen/report.ts`
**Tests:** `src/lib/mcpgen/emit/hardening.test.ts` (offset argument clamped and passed through, info gap, report assumption, generated test, filter tool walks offsets, filter tool omitted without a page size, adapter detection, bare `start` ignored)
**Commit:** 1dd71a2
**Applied fix:** `Operation.offsetParam`; the offset is exposed as an argument and filter tools iterate it (D-232). Status: fixed: requires human verification (generated paging loop not run).

### IN-01: Tables without a primary key page with no `ORDER BY`

**Files modified:** `src/lib/mcpgen/emit/python.ts`
**Tests:** `src/lib/mcpgen/emit/hardening.test.ts`
**Commit:** 1dd71a2
**Applied fix:** `rowid` ordering (D-233). Status: fixed.

### IN-04: `Object.prototype` property names dropped through `allOf`

**Files modified:** `src/lib/mcpgen/adapters/openapi.ts`
**Tests:** `src/lib/mcpgen/adapters/openapi.budget.test.ts`
**Commit:** abce4d2
**Applied fix:** Null-prototype property maps and own-property merging (D-227). Status: fixed.

### IN-05: Dead code and unused parameters

**Files modified:** `src/lib/mcpgen/emit/python.ts`
**Tests:** `src/lib/mcpgen/emit/hardening.test.ts` (source scan)
**Commit:** 1dd71a2
**Applied fix:** Removed `void op`, `void kind`, `void serverSlug`, the unused `plan` and `kind` parameters and the `serverSlug` import. Status: fixed.

### IN-06: CLI hazards

**Files modified:** `scripts/generate-mcp.ts`
**Tests:** `scripts/generate-mcp.hardening.test.ts`
**Commit:** e181cce
**Applied fix:** C1 controls are stripped; `isMainModule` compares file URLs (D-234). Status: fixed.

### IN-07 (README part): Markdown metacharacters from spec text

**Files modified:** `src/lib/mcpgen/generate.ts`
**Tests:** `src/lib/mcpgen/readme.test.ts`
**Commit:** 4c386c6
**Applied fix:** `mdText` escapes link, code and tag characters in the README title and tool lines (D-234). Status: fixed.

## Skipped Issues

None of the in-scope findings were skipped. Info findings left out deliberately (D-235):

- IN-02 (ceiling check rejects a partially valid last page) and IN-03 (enum comparison of booleans and floats) change check logic in several generated templates; not trivial.
- IN-07, bundle half (`GenerateMcpPanel.svelte` imports the registry statically): a component outside this fix's scope.

## Golden files

Commit 493eee5 regenerates eight golden files with `UPDATE_GOLDEN=1 npx vitest run` on the three golden suites (`emit/golden.test.ts`, `adapters/openapi.golden.test.ts`, `adapters/dataset.golden.test.ts`). I read every diff line; each change is a direct consequence of a fix above:

| Golden | Change | Cause |
| --- | --- | --- |
| all http servers (`acme-http`, `openapi`) | `_seg` rejects `.` and `..` | WR-01 |
| `acme-dataset`, `tabular` servers | `DATA_DELIMITER = ","` and `csv.DictReader(..., delimiter=DATA_DELIMITER)` | WR-05 |
| `acme-sql`, `sqlddl` servers | `COLLATE NOCASE` on equals, match docs say "ASCII letters only" | WR-07 |
| `acme-sql` server | `"order": "rowid"` for the table without a key | IN-01 |
| `acme-http` server | `See [link removed] for details` instead of `See  for details` | CR-03 (links of any scheme get the marker; before, the summary path dropped the link silently) |
| `acme-http.report.json` | new gap `source-text-copied` | WR-06 |
| `acme-http.test_server.py` | new `DOT_CASES` test | WR-01 |

No `*.model.json` golden changed, so adapter output for the fixtures is unchanged (the `_seg` traversal fix and the delimiter support only touch generated Python). The goldens were regenerated after all emitter changes; the hostile-input tests, not the goldens, pin the new behaviour.

## Notes for the orchestrator and for later phases

- Phase 15 interplay: `src/lib/mcptest` was not touched; its generator-subject tests pass unchanged (the new `source-text-copied` gap has no path and avoids the words the partial-spec check matches). D-174 (silent stale-example behaviour) is untouched.
- Decisions D-220..D-236 are appended to `.planning/AUTONOMOUS-DECISIONS.md`; `docs/mcp-generator.md` Safety section lists the new guarantees. No dependency was added.
- Behaviour changes users may notice: quoted prose after `password:`/`secret:` in a source is now rejected as credential-like (fail closed); input with URL userinfo, JWTs or vendor keys is rejected; a generated package is withheld if any emitted file still looks credential-like; `security: []` specs no longer require an API key.

---

_Fixed: 2026-10-13_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
