# Phase 15 human UAT (MCP test platform)

**E10 update 2026-10-14 (Claude, defects D1 to D4 fixed, see `.planning/exploration/E10-container-fixes.md`): item 3 now builds (image `localhost/aic-mcp-test-runner:dev`, user pi, tsx v4.23.15, Python 3.11.2, fastmcp 4.1.0; removed afterwards); item 4 now runs end to end through the platform in the container (generator:openapi, T1 + T2, status done in 37 s, no container left); item 2 and the fake-versus-real comparison now score 26.3 instead of 0 (see items). Ticks below are only for what was run in E9 or E10.**

**E9 update 2026-10-14 (Claude with Ville present, details in `.planning/exploration/E9-live-podman.md`): items 2, 3, 4 and 5 were run as far as possible without a browser or credentials; items 3 and 4 uncovered two real defects (see there). Items 1, 6 to 9 untouched or not applicable (see notes).**

Every item below was originally **pending human**. None of it was run unattended: no real FastMCP server, no container engine, no browser. All outputs go to `/tmp`; nothing here needs a real credential. Tick the box and note the outcome beside each item.

Run all commands from the repository root. Setup once:

```
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci
mkdir -p db
SEARCH_EMBEDDINGS=off npm run db:push && npm run ingest
```

## 1. FastMCP pin check
Status: DONE 2026-10-14 (run by Claude with Ville present). PyPI latest is fastmcp 4.1.0; 3.4.8 is the latest 3.x. Generated servers + tests pass on both; pin widened to `>=3.4,<5` (see decision log). `mcp.tool(fn)` registration works on both.
- [ ] Create a throwaway venv and see which version resolves:
  ```
  python3 -m venv /tmp/mcp-venv
  /tmp/mcp-venv/bin/pip install fastmcp httpx pyyaml
  /tmp/mcp-venv/bin/pip show fastmcp
  ```
- [ ] Confirm the current pin `fastmcp>=3.4,<4` and that `mcp.tool(fn)` registration works in that version. If not, update `FASTMCP_PIN` in `src/lib/mcpgen/emit/requirements.ts`, the same pin in `Containerfile.mcp-test-runner`, then regenerate goldens: `UPDATE_GOLDEN=1 npx vitest run src/lib/mcpgen` and review the diff.
- Expected: version 3.x resolves. Unverified: the pin has never been checked against the package index.

## 2. Generate a server, then score it through the CLI
Status: RUN 2026-10-14 (E9), CLI path works; RE-RUN 2026-10-14 (E10) after the binding fix (D3): 5 of 19 checks pass, score 26.3 (one earlier run under load scored 21.1 because one rerun hit an `initialize timed out`)
- E10 result (generate flat into `/tmp/.../acme-server`, which now holds `mcptest-binding.json`; throwaway venv with fastmcp 4.1.0 and httpx; `--reruns 3 --allow-local-exec`): verdict FAIL, score 26.3, PASS cells: tool_exists_lookup, auth_failure, pagesize_clamp, pagination_ceiling, auth_fail (and bound `explicit`), the other 14 fail on behaviour rather than names (lookup/search results do not match the mock: the openapi sample calls `/parts` and `/parts/{partId}` while the mock upstream serves `/items`, so the call results differ from the golden; cause not analysed further) or on roles the generated server lacks (`lookup_by_code`, `supplier_filter`, `lookup_by_alt_key`, `partition_filter`: `no tool`). This number is reported as measured, nothing was tuned.
- [x] Generate (ran; note: output is flat, `/tmp/acme-server/server.py`, there is no `<server-dir>` subdirectory (now removed from the commands); vars are `ACME_PARTS_BASE_URL` and `ACME_PARTS_API_KEY`):
  ```
  npm run generate-mcp -- --adapter openapi src/lib/mcpgen/testing/fixtures/acme-openapi.yaml --out /tmp/acme-server
  ```
  Open `/tmp/acme-server/README.generated.md` and note the base-URL and API-key variable names (`<BASE_URL_VAR>`, `<API_KEY_VAR>`).
- [x] Install the generated requirements and score (venv resolved fastmcp 4.1.0; server started, serverInfo `Acme Parts API 4.1.0`, tools `filter_part_by_features, lookup_part_by_id, search_part`; no crash, no ERROR cells; verdict FAIL, score 0, all 19 T2-CATALOG-API checks FAIL with `no matching tool`/`no tool` because `golden.jsonl` binds `tool_hint` `^lookup_item$` and `^search_items$` while the generator names tools `lookup_part_by_id` and `search_part`; this is a generator-vs-suite naming mismatch, see E9 defect D3) (the platform runs the server as a real process here, hence `--allow-local-exec`):
  ```
  /tmp/mcp-venv/bin/pip install -r /tmp/acme-server/requirements.txt
  npm run mcp-test -- --subject cmd:"/tmp/mcp-venv/bin/python /tmp/acme-server/server.py" --env-base-url <BASE_URL_VAR> --env-api-key <API_KEY_VAR> --case T2-CATALOG-API --reruns 3 --allow-local-exec --out /tmp/report.json
  ```
- Expected: protocol or banner surprises are likely (stdout noise, protocol version); they should show as findings, not crashes. Record the verdict and any `ERROR` cells (scorer problems) in the notes.

## 3. Build the runner image
Status: DONE 2026-10-14 (E10): `Containerfile.mcp-test-runner` fixed (install in /deps, move to /); builds with local rootless podman 4.9.3
- [x] E10: fixed and built (`podman build -t localhost/aic-mcp-test-runner:dev`, 607 MB; `node --version` v22.19.0; user pi uid 1000; `/node_modules/.bin/tsx` v4.23.15 and `tsx` on PATH; Python 3.11.2; fastmcp 4.1.0 in /opt/venv; no /deps left). Image and containers removed afterwards. Originally FAIL: Build and sanity-check. `podman build -t localhost/mcp-test-runner:latest -f Containerfile.mcp-test-runner .` fails at STEP 4/12: `npm error Tracker "idealTree" already exists` (npm 10.9.3 in node:22.19-bookworm-slim; `npm install --prefix /` with cwd `/` is broken, reproduced with a bare `podman run ... npm install --prefix / yaml@2.9.1`). Workaround used (scratch copy, repo file unchanged): `RUN mkdir /deps && cd /deps && npm install --no-save ... && cd / && mv /deps/node_modules /node_modules && rm -rf /deps`. With it the build succeeds in 2m30s, image 606 MB. Sanity: `node --version` = v22.19.0.
  ```
  podman build -t localhost/mcp-test-runner:latest -f Containerfile.mcp-test-runner .
  podman run --rm --network none localhost/mcp-test-runner:latest node --version
  ```
- [x] (on the workaround image) Check what the review fixes (CR-03, CR-04) assume about the image: output `pi`, uid 1000, `tsx v4.23.15`, `/node_modules/.bin/tsx`, `Python 3.11.2` (python3 on PATH is /opt/venv; fastmcp 4.1.0, httpx 0.28.1, PyYAML 6.0.3 installed). `/work` is `pi:pi`. (original text:)
  ```
  podman run --rm --network none localhost/mcp-test-runner:latest sh -c 'id -un && /node_modules/.bin/tsx --version && command -v tsx && python3 --version'
  ```
  Expected: user `pi` (uid 1000; D-464 renamed the node image's user, same convention as the Pi runner), a tsx version, `tsx` on PATH (`/node_modules/.bin/tsx`), a Python 3 version. The platform creates the container as user `pi` with no `/home/pi/agent` tmpfs and runs `/node_modules/.bin/tsx /work/src/lib/mcptest/driver.ts`.
- Expected: Node >= 22.19. The build installs Node and Python dependencies (network needed at build time only).
- [ ] Decide who owns the image tag and how the pins are updated (Question for Ville).

## 4. Container run through the platform
Status: DONE for the generator subject (2026-10-14, E10): D1 and D2 fixed; run through the platform in a container with AUTH_ENABLED=false works end to end
- [x] Start the app with the flag and the explicit runtime opt-in:
  ```
  MCP_TESTER=1 MCP_TESTER_RUNTIME=container npm run dev
  ```
- [x] E10: PASSED through the API (no browser): `POST /api/mcp-test/runs` with an Origin header, subject `generator:openapi`, cases T1-STD-CATALOG and T2-CATALOG-API, 1 rerun, `MCP_TESTER=1 MCP_TESTER_RUNTIME=container MCPTEST_RUNNER_IMAGE=localhost/aic-mcp-test-runner:dev`: queued, running, `done` in 37 s; report downloaded: runtime `container`, label `container runtime (sandboxed)`, T1 12 checks (5 PASS), T2 19 checks (4 PASS, 1 ERROR `auth_failure`: relaunch with a wrong key failed in the container, 14 FAIL). `podman ps -a` empty afterwards; network `aic-mcptest-internal` created by the platform (removed by hand). The browser part (progress UI) was not done. Originally FAIL (E9): Open `/mcp-test`, run `generator:openapi` with a small case set, watch progress, download `report.json`. Done through the API (no browser): `/mcp-test` 200, `POST /api/mcp-test/runs {"subject":"generator:openapi","cases":["T1-STD-CATALOG","T2-CATALOG-API","T4-PARTIAL-SPEC"],"reruns":1}` -> 202, run status `failed` after 8 s: `driver exited with code 1: ... code: 'ERR_REQUIRE_ASYNC_MODULE' Node.js v22.19.0`. Root cause (D1, verified by hand in the image): the driver tree is staged without a `package.json` with `"type":"module"`, so tsx compiles `driver.ts` as CJS and rejects its top-level await (`Top-level await is currently not supported with the "cjs" output format`, driver.ts:126). Mounting `{"type":"module"}` as `/work/package.json` fixes that. Next failure (D2): `ERR_MODULE_NOT_FOUND file:///work/src/lib/spec/security`, because `src/lib/mcptest/core/redact.ts` imports `../../spec/security` and `TREE_ROOTS` stages only `src/lib/mcptest` and `src/lib/mcpgen`.
- Expected: report runtime label is the container label; T4-PARTIAL-SPEC is dropped in container mode (documented limit).
- Code-side fix applied after the review (CR-03, D-241): the runner config for this image sets `runUser` and `mountAgentDir: false`, so `buildCreateOptions` names the user the Containerfile ends with and mounts no `/home/pi/agent` tmpfs (the Pi image is unchanged). User mismatch RESOLVED (D-464, decided by Ville 2026-10-14): the image now has the `pi` user (the Phase 8 runtime default) instead of `node`, `RUNNER_USER` is `pi`, and `/node_modules`, `/opt/venv` are world-readable/executable and `/work` is owned by pi. The image build itself is still pending human; nothing was built or run. Still pending human: confirm the engine accepts the create options with `ReadonlyRootfs` plus the `/work` and `/tmp` tmpfs mounts, that the staged files are writable and readable by uid 1000, and that the driver writes `/work/out/report.json`.
- [ ] PARTIAL: Confirm no `mcptest-*` container is left behind after a normal run, after a timeout and after a cancel. Checked: after the failed API run and after a run with `MCPTEST_JOB_TIMEOUT_MS=4000` (`failed: the container run timed out`, 5.2 s) `podman ps -a` was empty. Cancel path not exercised (no cancel route used). Sweep-vs-in-flight not exercised. Run through the production `executeRun` with a runtime shim that adds the two missing staged files (E9 `shim.mts`): status done in 18.3 s, no container left, network `aic-mcptest-internal` created by the platform (removed by hand afterwards). Also: the container-mode T4-PARTIAL-SPEC drop is documented behaviour, request with it still succeeded. (`podman ps -a --filter label=aic.mcptest=1`). Containers now also carry `aic.tryitout=1` and `aic.owner`, so the Try It Out orphan sweep removes leftovers from a previous process; confirm that sweep does not touch a run in flight.
- [x] E10: no longer blocked; both requested cases are in the report with real checks (see above). E9 text: report from the shimmed run has `run.runtime=container`, `runtimeLabel="container runtime (sandboxed)"`, both requested cases present with 12 (T1) and 19 (T2) real checks, `timings` set; verdict DISQUALIFIED, all T1 and 16/19 T2 checks FAIL because of the tool-name mismatch (D3). Open the downloaded report and check that `cases` contains every requested case with real checks (not zero checks): the driver tree now includes `golden.jsonl` and the csv fixtures, and an empty golden is an error.

## 5. Fake versus real comparison
Status: DONE 2026-10-14 (E9)
- [x] Produce a fake report for the same case and compare cell by cell with the real report from item 2:
  ```
  npm run mcp-test -- --subject fake:good --case T2-CATALOG-API --out /tmp/report-fake.json
  ```
- E10 re-run after the binding fix (D3): fake:good still 19/19, the real generated server (CLI, local exec, 3 reruns) now 5/19 (score 26.3); the container run of generator:openapi gives 4 PASS and 1 ERROR (`auth_failure`, a wrong-key relaunch failed inside the container) on the same case. Remaining differences are real-server behaviour (mock route mismatch, see item 2), not naming.
- Result: fake:good passes 19/19 T2-CATALOG-API checks (verdict INCOMPLETE because only one case was requested); the real generated server (CLI, local exec) passes 0/19 (verdict FAIL); all 19 cells differ. The container run of the same server (shimmed) differs from the CLI run in only three cells (pagesize_clamp, pagination_ceiling, bad_input PASS in the container, FAIL in CLI), probably because those checks pass on a failing/erroring server in the container where no mock upstream is reachable; not analysed further. Cause of the main discrepancy: fake:good exposes `lookup_item`, `search_items` (the names in the suite's `tool_hint`), the generator emits `lookup_part_by_id`, `search_part`, `filter_part_by_features`.
- Expected: differences are discrepancies in the fake model or the real server; list them. Fake variants are scorer fixtures, not predictions.

## 6. T2-CATALOG-DUMP real run
Status: pending human (E9 tried once: the tabular server generated from `acme-catalog-header.csv` with env `ACME_WIDGETS_DATA_PATH`, but `--case T2-CATALOG-DUMP` came back `NA` / `INCOMPLETE` (coverage 0/0), so the case did not run; not pursued)
- [ ] Generate a tabular server and run the dump case with a data path (the runner supplies the dump fixture path through the env for real-runtime cases; check the printed command):
  ```
  npm run generate-mcp -- --adapter tabular-catalog src/lib/mcpgen/testing/fixtures/<tabular-fixture> --out /tmp/acme-tabular
  npm run mcp-test -- --subject cmd:"/tmp/mcp-venv/bin/python /tmp/acme-tabular/server.py" --case T2-CATALOG-DUMP --allow-local-exec --out /tmp/report-dump.json
  ```
- Expected: the case runs (no longer `PENDING_HUMAN`). Note whether the data-path variable name (`ACME_*_DATA_PATH`) reaches the server (Questions for Ville).

## 7. Browser and keyboard check
Status: pending human
- [ ] Flag off (`npm run dev` without `MCP_TESTER`): `/mcp-test` and `/api/mcp-test/runs` return 404; the Customize menu has no tester entry and looks unchanged.
- [ ] Flag on (`MCP_TESTER=1 npm run dev`): the Customize menu shows the entry; `/mcp-test` lists fake variants and generator samples plus a disabled "Real server" entry; start a `fake:good` run; progress updates; the verdict and matrix render; `report.json` downloads.
- [ ] Keyboard only: tab order, focus ring, menu entry reachable with arrow keys, Enter starts a run, results announced.
- [ ] Screen reader pass (NVDA or VoiceOver) of progress and result announcements; 200% zoom.
- Expected for `fake:good` over all cases: verdict FAIL at coverage 6/7 (the dump case is pending human; see D-168 in AUTONOMOUS-DECISIONS.md). Confirm this reads sensibly to you.

## 8. Auth hook and rate limit
Status: pending human
- [ ] With auth enabled in a deployment, confirm `/api/mcp-test/runs` (POST), `/api/mcp-test/runs/<id>` and `/api/mcp-test/runs/<id>/report` are covered by the global hook the same way as other `/api/*` routes: `curl -i -X POST http://localhost:5173/api/mcp-test/runs -H 'content-type: application/json' -d '{"subject":"fake:good"}'` without a session.
- [ ] Same check for `/api/mcp-generate` (Phase 14 caveat).
- [ ] Decide whether the 10 starts per client per 10 minutes limit is enough for production.

## 9. Optional questions for the study author
Status: pending human
- [ ] Is the Acme stand-in of the T2 case faithful enough to the study's case structure? (Never share or commit real data.)
- [ ] The real partner-profile text for T3-PROFILE-CONTRACT, if mapping is wanted; it must never be committed.
- [ ] Is the headline score formula (mean of Tier 2 and Tier 3 case pass-rates) what the study uses?

See "Questions for Ville" in `.planning/AUTONOMOUS-SUMMARY.md` for the consolidated list.
