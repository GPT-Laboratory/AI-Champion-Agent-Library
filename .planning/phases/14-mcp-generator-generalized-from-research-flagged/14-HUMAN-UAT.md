# Phase 14 Human UAT (pending)

Everything below is `pending human`: the unattended run has no browser, never executes generated Python and never installs Python packages. Run commands from the repository root unless a `cd` is shown. Outputs go to `/tmp`, outside the repo.

## 14-03/14-04/14-05 Generate from each fixture (CLI)
Status: pending human
```bash
npm run generate-mcp -- --adapter openapi src/lib/mcpgen/testing/fixtures/acme-openapi.yaml --out /tmp/acme-mcp-openapi
npm run generate-mcp -- --adapter tabular-catalog src/lib/mcpgen/testing/fixtures/acme-catalog-header.csv --out /tmp/acme-mcp-tabular
npm run generate-mcp -- --adapter sql-ddl src/lib/mcpgen/testing/fixtures/acme-schema.sql --out /tmp/acme-mcp-sql
npm run generate-mcp -- --adapter sql-ddl src/lib/mcpgen/testing/fixtures/acme-openapi.yaml --out /tmp/acme-mcp-wrong; echo "exit=$?"
```
- Expect the first three to exit 0 and print a report, with `server.py`, `test_server.py`, `requirements.txt`, `README.generated.md`, `report.json` under each `--out`.
- Expect the fourth to exit 2 (wrong adapter forced, no fallback) and write nothing.

## 14-02 Python smoke of a generated server (needs network for pip)
Status: pending human
```bash
cd /tmp/acme-mcp-openapi
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt pytest
pytest -q
```
- Expect all generated behaviour tests to pass. Repeat for `/tmp/acme-mcp-tabular` and `/tmp/acme-mcp-sql`.
- Stdio launch (use the actual variable names from `README.generated.md`):
  `ACME_PARTS_BASE_URL=http://127.0.0.1:9 ACME_PARTS_API_KEY=dummy python server.py < /dev/null`
  Expect it to start and exit cleanly on EOF without a traceback.

## 14-01/14-02 FastMCP version pin check (UNVERIFIED, synthesis section 6 Q4)
Status: pending human
```bash
python3 -m pip index versions fastmcp
python3 -m venv /tmp/fmcp && /tmp/fmcp/bin/pip install 'fastmcp>=3.4,<4' && /tmp/fmcp/bin/python -c "from fastmcp import FastMCP; print(FastMCP)"
```
- Expect a 3.4.x or later 3.x release to be installable and the import to work. Also confirm `mcp.tool(fn)` registers a plain function (generated servers use this form, D-145). If not, adjust `src/lib/mcpgen/emit/requirements.ts` and the emitter, then refresh goldens with `UPDATE_GOLDEN=1 npx vitest run src/lib/mcpgen`.

## 14-02 Run a generated test_server.py in a throwaway venv
Status: pending human
- Covered by the Python smoke item above (`pytest -q` in a fresh virtualenv); this repo only py_compiles generated code and never runs it. Record the pytest pass count here when done.

## 14-04 Dataset and SQL servers against synthetic data
Status: pending human
- Create a tiny synthetic `acme.csv` (header from the tabular fixture plus 3 invented rows) and an `acme.sqlite3` (run the statements of `acme-schema.sql` with `sqlite3`, plus 3 invented inserts).
- Point the `<NAME>_DATA_PATH` / `<NAME>_DB_PATH` variables (names in each `README.generated.md`) at them, run the generated tests, then call a `query_*` tool through any MCP client using the `.mcp.json` snippet from the README.
- Expect results trimmed to at most 12 fields, an honest empty message for a miss, and (SQL) stable paging on the composite-key table.

## 14-06 Generate MCP panel with the flag on (browser, zip download)
Status: pending human
```bash
MCP_GENERATOR=1 npm run dev
```
- Open any `/agents/<slug>`, Customize, Generate MCP. Paste the OpenAPI fixture, leave the adapter on auto-detect, Generate. Expect a zip download whose folder contains the five files above, and the textarea cleared afterwards.
- Paste text containing a fake token such as `sk-` followed by 24 random letters. Expect a rejection alert that does not repeat the pasted token, and the textarea content kept for fixing.
- Keyboard only: Tab to Customize, Enter, reach Generate MCP, Enter, type, Tab to Generate; Escape closes the panel and returns focus to Customize. A screen-reader pass (status and alert announcements) is human-only.
- Note: the route adds no authentication of its own; whether you must be signed in follows the deployment's global request hook settings (not verified for this route).

## 14-06 Flag off (browser and curl)
Status: pending human
```bash
unset MCP_GENERATOR; npm run dev
curl -i -X POST http://localhost:5173/api/mcp-generate -H 'content-type: application/json' -d '{}'
```
- Expect Customize to show only the three "Coming soon" items, exactly as in Phase 4, and the curl to return 404. If authentication is enabled in your dev setup, a 401 from the global hook can appear before the route runs; sign in or disable auth as described in the README.

## 14-07 Optional follow-up questions to the study author
Status: pending human
- Synthesis section 6 Q6: why did openapi-mcp-generator score 0 of 5 on functional checks (binding or real defect), and was the unfinished `combined` arm ever meant to be benchmarked?


## Results recorded 2026-10-14 (run by Claude with Ville present; python3 3.12.3, throwaway venvs in the scratchpad)
- CLI generation from the three fixtures exit 0; forced wrong adapter exit 2: PASS.
- FastMCP on PyPI: latest is 4.1.0 (4.0.0 GA 2026-08-31); 3.x is still maintained (3.4.8 on 2026-10-04). The pin `fastmcp>=3.4,<4` is valid but excludes the current major.
- Generated test suites (openapi 23, tabular 11, sql 35 = 69 tests) all pass on fastmcp 3.4.8 AND 4.1.0. `mcp.tool(fn)` registration works on both.
- Real MCP over stdio (FastMCP Client): openapi server lists 3 tools and returns a structured upstream error (no raw envelope) when the upstream is unreachable; tabular and sql servers (synthetic CSV / SQLite, 3 invented rows) filter, return an honest empty-result message, clamp limit (9999 -> 50) and page deterministically on the composite-key table. Both versions identical.
- Observation: the dataset server returns only the first column by default (`default_fields`), so callers must pass `fields` for more; by design but possibly too terse.
- Browser items (Generate MCP panel, keyboard/screen reader, flag off view) remain pending human.

## Results recorded 2026-10-14 (second batch): new adapters, real FastMCP
Generated from the synthetic fixtures with the CLI (all exit 0) and ran each package's own pytest in throwaway venvs, fastmcp 3.4.8 and 4.1.0: odata-xml 12, odata-json 12, swagger2 23, oauth2 17, openapi31 17, pgdump 35, mysqldump 19, sqlite-schema 27, prisma 27 tests, all passed on BOTH versions (18 of 18 package runs). Not covered: real MCP stdio calls against a live OData service (none available offline), browser items.
