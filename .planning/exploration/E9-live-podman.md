# E9 live Podman checks (2026-10-14)

Host: rootless Podman 4.9.3, 3.8 GB RAM, podman-compose 1.0.6, node v22.23.3. Branch `autonomous/overnight-improvements`, no source or test changes. AUTH_ENABLED=false (compose through a scratch override file). Run strictly sequentially; `available` memory never dropped below about 1.4 GB (the `free` column dipped to 161 MB with two dev servers plus the stack, buff/cache absorbed it).

## Results

| Check | Result | Evidence (short) |
|---|---|---|
| P9-1a smoke tmpfs | PASS | 11 PASS lines, dns SKIP, `cleanup: 0 smoke containers left`, 11 s |
| P9-1b compose + `--proxy-host` | PASS | `dns aic-agent-library: 10.89.0.7`, egress blocked exit=3, cleanup 0 |
| P9-2 hardening | PASS | `user=pi ro=true no-new-privileges mem=swap=1073741824 pids=200 ports=map[]`, only AIC_LLM_TOKEN; capdrop prints 11 expanded caps (not `[ALL]`), effective `CapEff=0`, `NoNewPrivs=1` |
| P9-3a network guard live | PASS | external `ENETUNREACH`, app `200`, peer `ECONNREFUSED` |
| P9-3b open network refused | PASS | `network "aic-pi-open" is not internal; refusing...`, network removed |
| P9-4 orphan sweep owner scoping | PASS | owner-a survived B restart, owner-b stale swept, no-owner legacy container survived |
| P9-5 hostile archive | PASS | symlink skipped, `output exceeds 20971520 bytes`, `__proto__` plain key, RSS 105 to 107 MB, sockets 0 to 0 |
| P9-6 hung engine | PASS | job in `claiming container...` exactly 90 s, then bounded fallback; after CONT a new job used a warm container |
| P9-7 budget with real model | SKIPPED | needs paid key |
| P9-8a reaper TTL | PASS | TTL 15 s: container gone 29 s after creation (limit 15 + 30) |
| P9-8b stalled warm | PASS | warm wait 5 s: slot busy at t+2 s, free at t+8 s |
| P9-9 compose down cleanup | FAIL (partial) | containers gone (PASS); `aic-pi-internal` and `aic-agent-library_default` networks remain after `podman-compose down` |
| P15-1 FastMCP pin | not re-run | already DONE per file; venv resolved fastmcp 4.1.0 again |
| P15-2 generate + CLI score | PASS (with finding) | server runs, no crash, 0/19 because tool names differ (D3) |
| P15-3 build runner image | FAIL | npm `Tracker "idealTree" already exists` (D4); with workaround 2m30s, 606 MB, user pi, tsx 4.23.15, Python 3.11.2, fastmcp 4.1.0 |
| P15-4 container run through platform | FAIL | `ERR_REQUIRE_ASYNC_MODULE` (D1), then `ERR_MODULE_NOT_FOUND src/lib/spec/security` (D2); works with a shim adding the two files: done, 18 s, no leftover container |
| P15-4 cleanup after timeout | PASS | `MCPTEST_JOB_TIMEOUT_MS=4000`: `failed: the container run timed out`, `podman ps -a` empty |
| P15-4 cancel, sweep-vs-in-flight | BLOCKED | not exercised without the browser / cancel route |
| P15-5 fake vs real | PASS (done) | fake 19/19, real 0/19; cause D3 |
| P15-6 T2-CATALOG-DUMP | NOT RUN | case is `NA` for a `cmd:` tabular subject (coverage 0/0); not pursued |
| P15-7 browser/keyboard, P15-8 auth | SKIPPED | browser / auth session needed |
| P15-9 questions | SKIPPED | human questions |

Counts: PASS 13 (P9 1a, 1b, 2, 3a, 3b, 4, 5, 6, 8a, 8b; P15 2, 4-timeout, 5), FAIL 3 (P9-9 network, P15-3, P15-4), BLOCKED 1, SKIPPED/NOT RUN 5.

## Defects

All verified by hand; no source changed.

- **D1 (High, container path unusable): driver tree staged without `package.json` `{"type":"module"}`.** `containerRun.ts` stages `src/lib/mcptest` and `src/lib/mcpgen` into the tmpfs `/work`; tsx compiles `/work/src/lib/mcptest/driver.ts` as CJS and fails: `Top-level await is currently not supported with the "cjs" output format` (driver.ts:126), surfacing as `ERR_REQUIRE_ASYNC_MODULE`. Reproduced with `podman run -v $PWD/src:/work/src:ro ... tsx driver.ts`; adding `-v pkgtype.json:/work/package.json` fixes it. Fix: stage `{ path: 'package.json', content: '{"type":"module"}' }` in the `staged` list in `runInContainer` (`/work` is a tmpfs, so baking it in the image does not help). Fake-runtime tests cannot see this.
- **D2 (High, same path): `src/lib/spec/security.ts` not staged.** `src/lib/mcptest/core/redact.ts` imports `../../spec/security`; `TREE_ROOTS` is only `['src/lib/mcptest','src/lib/mcpgen']`. Failure: `ERR_MODULE_NOT_FOUND file:///work/src/lib/spec/security`. Fix: add `src/lib/spec/security.ts` (self-contained, no imports) to the staged tree or move the helper into mcptest. A test that imports the driver graph from the staged set only would catch both D1 and D2 (resolve every relative import of the staged files against the staged paths).
- **D3 (Medium, scoring): generator-emitted tool names do not match the suite hints.** Suite `golden.jsonl` binds `^lookup_item$`, `^search_items$`; the generator (openapi adapter, acme fixture) emits `lookup_part_by_id`, `search_part`, `filter_part_by_features`. Every T1/T2 check of a generated server therefore FAILs (`no matching tool`), in both the CLI and the container run. Either the hints should accept the generator naming (e.g. `^lookup_`) or the study intends binding to be done by a human; the UAT text expects "findings", this is one, but it makes the verdict (0/19) uninformative for real generated servers.
- **D4 (High, build): `Containerfile.mcp-test-runner` does not build.** `npm install --prefix / ...` fails in node:22.19-bookworm-slim (npm 10.9.3) with `Tracker "idealTree" already exists`; reproduced standalone. Workaround that built: `RUN mkdir /deps && cd /deps && npm install --no-save --no-audit --no-fund --ignore-scripts yaml@2.9.1 zod@4.6.7 fflate@0.8.3 tsx@4.23.15 && cd / && mv /deps/node_modules /node_modules && rm -rf /deps && npm cache clean --force`. The test `containerfile.test.ts` only reads the file.
- **D5 (Low, docs): Phase 9 UAT and runbook text.** (a) `podman ps --format '{{.Label "aic.owner"}}'` is invalid on 4.9.3, use `{{.Labels}}`; (b) item 2/3 `head -1` picks the oldest container, which can be a pre-Phase-9 one; (c) item 2 expects `capdrop=[ALL]`, podman 4.9.3 prints the 11 expanded capabilities (effective set is empty); (d) item 6 `pgrep -f 'podman system service'` is usually empty because the service is socket-activated and idle-exits, use `systemctl --user show -p MainPID --value podman.service` after a ping; (e) item 9 expects the network gone after `podman-compose down`, but podman-compose 1.0.6 leaves it (add `podman network rm aic-pi-internal` or change the expectation); (f) POSTs to the dev/compose app need an `Origin` header matching `ORIGIN` (CSRF); compose `ORIGIN` comes from `.env` (was `http://localhost:5173`); (g) Phase 15 item 2 says `<server-dir>`, but the output is flat.
- **Note N1 (Low, Containerfile): `chown -R node:node /app` layer is 825 MB** (duplicate of the copied node_modules and db layers). Use `COPY --chown=node:node` and `mkdir`+`chown` of only the runtime dirs; the app image is 2.68 GB (previous tag was 863 MB).
- **Note N2: with `PI_FALLBACK_ENABLED=true` a warm timeout silently turns into a direct model call (real spend if a key is configured).** Seen in P9-6; documented behaviour, but surprising during a chaos check.

## Resource notes

- App image build (`podman-compose up -d --build`, cold cache): 27m48s (user 4m42, sys 2m55); image `localhost/aic-agent-library:latest` 2.68 GB. Memory stayed fine (available about 2 GB during the build).
- `localhost/pi-runner:latest` 387 MB (not rebuilt; already user `pi`, pi 1.0.4).
- `mcp-test-runner` build 2m30s (plus about 25 s pull of node:22.19-bookworm-slim, 230 MB), image 606 MB; removed afterwards together with the pulled node:22.19 image.
- Run times: smoke 11 s; container warm about 1 to 3 s; container driver run (2 cases, 1 rerun) 18 s, 3-4 s of that start/stage; `podman-compose down` 2.4 s.
- Memory: two vite dev servers plus compose stack plus Pi containers left `available` at 1.4 to 2.1 GB (of 3.8 GB); compose app container about 171 MB; swap used 1.5 GB at start (pre-existing). Disk: 117 GB total, 85 GB used before, 89 GB after the builds (cleaned: dangling images pruned).
- Scratch artefacts (not in the repo): `/tmp/claude-1000/.../scratchpad/` (override.yml, shim.mts, hostile.mts, reports, patched Containerfile, venv).

## Final Podman state

Containers: none. Images: `localhost/aic-agent-library:latest` (rebuilt), `localhost/pi-runner:latest`, `docker.io/library/node:22-bookworm-slim`; dangling images from this session and the old aic-agent-library image removed. Networks: `aic-pi-internal` (pre-existing, internal), `aic-agent-library_default` (pre-existing), `podman`; `aic-pi-open` and `aic-mcptest-internal` created during the checks were removed. Volumes: `aic-agent-library_tryout-sessions`, `aic-agent-library_auth-data` (pre-existing, 2026-10-12). The old container `aic-pi-e6768063c826` was removed (authorised). An unrelated `vite dev --port 5199` process on the host (not started here) was left alone.
