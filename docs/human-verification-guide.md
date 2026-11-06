# Human verification guide (browser checks)

Everything here needs eyes, a keyboard or a screen reader, so it cannot be automated. The automated suite (`npm run check`, `npm run smoke`) already passes; this guide covers what it cannot see. About 45 minutes for a full pass. Tell Claude the results (even "all fine") and the matching `*-HUMAN-UAT.md` files and verification statuses get updated.

## 0. Start a demo server with everything switched on

The demo database is a copy of the dev database plus the shipped agents and all the synthetic submission samples (systems, MCP servers, a skill, an external agent), so every feature has something to show. It lives in `/tmp` and never touches `db/catalog.db`. Run once from the repository root:

```bash
D=/tmp/aic-demo; rm -rf $D && mkdir -p $D/agents
cp data/agents/*.yaml $D/agents/ && cp -r fixtures/submissions/* $D/agents/
cp db/catalog.db $D/catalog.db      # needs `npm run db:push` to have been run once
sqlite3 $D/catalog.db 'delete from agents; delete from agent_kinds; delete from agent_embeddings;' \
  || python3 -c "import sqlite3;c=sqlite3.connect('$D/catalog.db');[c.execute('delete from '+t) for t in ('agents','agent_kinds','agent_embeddings')];c.commit()"
CATALOG_DB_PATH=$D/catalog.db INGEST_DB_PATH=$D/catalog.db INGEST_DATA_DIR=$D/agents AGENT_KINDS=1 npm run ingest
```

(The first ingest downloads the search model once, about 90 MB, then it is cached under `db/models`. Add `SEARCH_EMBEDDINGS=off` to skip it; search is then keyword-only.)

Then start the server (leave it running; open http://127.0.0.1:5173):

```bash
CATALOG_DB_PATH=/tmp/aic-demo/catalog.db AUTH_ENABLED=false AGENT_KINDS=1 AGENT_COMPARE=1 \
UI_SPEC_VIEWER=1 UI_DARK_MODE=1 MCP_GENERATOR=1 MCP_TESTER=1 npx vite dev --host 127.0.0.1
```

To check how everything looks with the features **off** (they must look exactly like before), restart the same command without the six flag variables.

Useful pages in the demo data: system agents `example-review-team`, `example-support-swarm`, `example-research-crew`; MCP server `example-weather-mcp`; skill `skill-example`; plain agents `hvac-load-calculator`, `rfi-triage-assistant`, `demo-rfi-triage`.

## 1. Phase 2 checkpoint 02-04 (catalog and detail) — the one that blocks marking Phase 2 complete

1. Open `/` : redirects to `/catalog`.
2. Catalog: cards in a responsive grid; category / model / status filters update the list without a full reload; pagination works; try tablet width (about 768 px) with no horizontal scrolling.
3. Open any agent: name, purpose, use cases and GitHub link visible; technical details hidden until you expand "Technical Specification"; the customization panel lists tailorable fields.
4. `/agents/does-not-exist` shows a friendly 404 page.

## 2. Search (Phase 3) — see `.planning/phases/03-search/03-HUMAN-UAT.md` items 3 and 4

On `/catalog` type "hvac" fast: list narrows about 200 ms after the last keystroke, the input keeps focus and caret, the page does not jump; URL shows `?q=hvac`; clearing the box restores the list; a nonsense query shows `No agents match "..."`. Try a paraphrase: "how much air does each room need". Use browser back/forward after searching: the box shows the right query.

## 3. Customize menu (Phase 4) — `04-HUMAN-UAT.md`

Detail page: "Customize" button on every agent; menu lists Configure fields, Connect your data, Change model (plus "Generate MCP" and "Test MCP servers" with the flags on), the three placeholders show "Coming soon" and no error; Esc closes and returns focus; arrows move; click outside closes; fits on a tablet width.

## 4. Related agents (Phase 11) — `11-HUMAN-UAT.md`

Detail page: "Related agents" section under the accordion, up to 4 cards, never the page's own agent; click one and the new page shows fresh content; suggestions look sensible for the real agents.

## 5. Accessibility (Phase 10) — `10-HUMAN-UAT.md` (the big one)

Keyboard walk of catalog and detail (skip link, focus order, visible focus ring, Customize menu, Try it out toggle); screen reader pass (NVDA + Firefox or VoiceOver + Safari: result-count announcements, landmarks, card link names); 200% and 400% zoom; real-browser contrast with axe DevTools or Lighthouse; reduced motion and forced colours. Also confirm the darker control borders (gray-500) look acceptable.

## 6. Flagged features (all on in the demo server)

| Feature | Where | What to check |
|---|---|---|
| Kinds (Phase 13) `13-HUMAN-UAT.md` | `/catalog`, `/agents/example-review-team` | Kind badge on non-agent cards; "Type" filter appears and `?kind=system` filters; system page shows kind badge, Members and topology, no language-model line, no runnable Try It Out |
| Raw spec viewer (UI-04) `.planning/exploration/E1-spec-viewer.md` | any agent page | "Raw spec" toggles with Enter/Space; YAML is readable, scrolls with the keyboard; tokens show `[redacted]` |
| Compare (DISC-02) `E4-compare.md` | `/catalog`, `/compare` | Tick 2–3 cards with Space; 4th box disables; selection survives paging/filtering; "Compare selected" table is readable on phone width; differences are marked |
| Dark mode (UI-02) `E5-dark-mode.md` | nav toggle (Light / Dark / System) | Every page legible in dark; borders, placeholders, disabled buttons, translucent backgrounds; "System" follows your OS setting; reload keeps the choice, no flash |
| Generate MCP (Phase 14) `14-HUMAN-UAT.md` | agent page, Customize, Generate MCP | Paste `src/lib/mcpgen/testing/fixtures/acme-openapi.yaml`, Generate: a zip downloads; paste a fake `sk-` token: rejected without echoing it |
| MCP test platform (Phase 15) `15-HUMAN-UAT.md` | `/mcp-test` (also in Customize) | Run the fake "good" variant: progress shows, report downloads, score 100 with the pending-case note; a flawed variant shows failed checks and flags |

## 7. Flags off

Restart without the six flag variables. Catalog, detail, nav and Customize must look exactly as they did before this work, `/compare`, `/mcp-test` and `/api/mcp-generate` must be 404.

## 8. Live Podman checks (Phase 9 and the Phase 15 container run)

Environment note: this machine has 3.7 GB RAM. Run these strictly one at a time and never alongside heavy agents or test runs (check `free -m`; stop if available memory drops below about 300 MB). Run from the repository root. `localhost/pi-runner:latest` and the `aic-pi-internal` network must exist (`podman images`, `podman network ls`).

Setup once: `systemctl --user enable --now podman.socket`.

1. **Smoke script (about 11 s):** `npx tsx scripts/smoke-pi-runner.ts`. Expect every line `PASS` (`dns` may `SKIP`) and a final `cleanup: 0 smoke containers left`.
2. **Start the app and warm a container:** `AUTH_ENABLED=false npm run dev -- --host 127.0.0.1`, open http://127.0.0.1:5173/agents/demo-rfi-triage, then `podman ps --filter label=aic.tryitout`.
3. **Hardening:**
   ```bash
   C=$(podman ps --filter label=aic.tryitout --format '{{.Names}}' | head -1)
   podman inspect "$C" --format 'user={{.Config.User}} ro={{.HostConfig.ReadonlyRootfs}} secopt={{.HostConfig.SecurityOpt}} mem={{.HostConfig.Memory}} swap={{.HostConfig.MemorySwap}} pids={{.HostConfig.PidsLimit}} ports={{.NetworkSettings.Ports}}'
   podman inspect "$C" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^(AIC_|OPENAI)'
   podman exec "$C" grep CapEff /proc/1/status
   ```
   Expect `user=pi ro=true`, `secopt` with `no-new-privileges`, `mem` = `swap` = 1073741824, `pids=200`, no ports, only `AIC_LLM_TOKEN` in the env, `CapEff: 0000000000000000` (Podman 4.9 prints 11 expanded caps for `capdrop`, so check `CapEff` instead).
4. **Network guard:** `podman exec "$C" node -e "fetch('https://example.com').then(r=>console.log('REACHED',r.status),e=>console.log('BLOCKED',e.cause?.code||e.message))"` expects `BLOCKED` (ENETUNREACH). The app-reachable check works only when the app runs in compose (step 9). The open-network guard:
   ```bash
   podman network create aic-pi-open
   PI_RUNNER_NETWORK=aic-pi-open PI_RUNNER_ALLOW_OPEN_EGRESS=false npx tsx scripts/smoke-pi-runner.ts   # expect FAIL: "not internal"
   podman network rm aic-pi-open
   ```
5. **Hostile archive:** passed live already and covered by automated tests; skip.
6. **Orphan sweep owner scoping (two servers):**
   ```bash
   APP_INSTANCE_NAME=owner-a AUTH_ENABLED=false npm run dev -- --port 5173 &    # warm via /agents/demo-rfi-triage
   APP_INSTANCE_NAME=owner-b AUTH_ENABLED=false npm run dev -- --port 5174 &    # warm via the same page on :5174
   podman ps --filter label=aic.tryitout --format '{{.Names}} {{.Labels}}'
   ```
   Stop and restart only the :5174 server and list again. Expect owner-a's container to survive and owner-b's old one to be removed. Stop both servers afterwards.
7. **Hung engine:**
   ```bash
   podman ps >/dev/null; PID=$(systemctl --user show -p MainPID --value podman.service)
   kill -STOP "$PID"      # start a job in the UI now; wait about 100 s
   kill -CONT "$PID"
   podman ps -a --filter label=aic.tryitout --format '{{.Names}} {{.Status}}'
   ```
   Expect a bounded failure after about 90 s (never an endless spinner), recovery after `CONT`, and no orphan container.
8. **Reaper timing:** `PI_RUNNER_IDLE_TTL_MS=15000 AUTH_ENABLED=false npm run dev -- --host 127.0.0.1`, warm one container, then `podman ps --filter label=aic.tryitout --format '{{.Names}}'; sleep 46; podman ps --filter label=aic.tryitout --format '{{.Names}}'`. Expect it gone within about 15 s plus one 30 s reaper tick.
9. **Compose up and down (re-run needed: check 9 is still unticked).** Create `override.yml`:
   ```yaml
   services:
     aic-agent-library:
       environment:
         AUTH_ENABLED: "false"
   ```
   ```bash
   podman-compose -f podman-compose.yml -f override.yml up -d      # no --build; the image is current
   npx tsx scripts/smoke-pi-runner.ts --proxy-host aic-agent-library
   podman-compose -f podman-compose.yml -f override.yml down
   podman ps -a --filter label=aic.tryitout        # expect empty
   ```
   `down` leaves the `aic-pi-internal` and `aic-agent-library_default` networks (harmless; the UAT expectation was corrected); volumes stay. POSTs to the compose app need an `Origin` header equal to `ORIGIN`.
10. **Budget enforcement (needs your OpenAI key, small spend; still pending):** `PI_JOB_TOKEN_BUDGET=3000 PI_JOB_REQUEST_BUDGET=5 npm run dev -- --host 127.0.0.1`, run a long job. Expect `failed` with `job token budget exceeded` and spend no more than the budget plus one capped completion (4096 tokens).

Cleanup: `podman ps -a --filter label=aic.tryitout -q | xargs -r podman rm -f`, and stop background dev servers (`jobs`, `kill %1 %2`).

### Phase 15 container run (the fixes landed 2026-10-14; the platform path passed through the API, the items below remain for you)

1. **Build the runner image** (needs network, about 2.5 min, 607 MB): `podman build -t localhost/aic-mcp-test-runner:dev -f Containerfile.mcp-test-runner .`, then `podman run --rm --network none localhost/aic-mcp-test-runner:dev sh -c 'id -un && command -v tsx && python3 --version'`. Expect user `pi`, a `tsx` path, Python 3.11.
2. **Run through the platform:**
   ```bash
   MCP_TESTER=1 MCP_TESTER_RUNTIME=container MCPTEST_RUNNER_IMAGE=localhost/aic-mcp-test-runner:dev AUTH_ENABLED=false npm run dev -- --host 127.0.0.1
   ```
   In the browser open `/mcp-test`, pick `generator:openapi` with cases T1-STD-CATALOG and T2-CATALOG-API, start, watch progress, download `report.json`. Expect the runtime label "container runtime (sandboxed)", T4-PARTIAL-SPEC dropped (documented limit), and one `auth_failure` ERROR cell that is not yet analysed. Through curl: `curl -i -X POST http://127.0.0.1:5173/api/mcp-test/runs -H 'content-type: application/json' -H 'Origin: http://127.0.0.1:5173' -d '{"subject":"generator:openapi","cases":["T1-STD-CATALOG","T2-CATALOG-API"],"reruns":1}'`.
3. **Cancel and cleanup (never exercised):** start a run, cancel it from the UI, then `podman ps -a` must show no `mcptest-*` container; also after `MCPTEST_JOB_TIMEOUT_MS=4000` timeouts.
4. **Sweep versus run in flight (never exercised):** restart the app while a container run is active; it must not remove the active container.
5. **Auth-enabled check:** with `AUTH_ENABLED` unset, `/api/mcp-test/runs` and `/api/mcp-generate` must answer 401 without a session.
6. **Dump case:** generate a tabular server and run `T2-CATALOG-DUMP` with a data path (see `15-HUMAN-UAT.md` item 6).
7. After you finish: `podman image rm localhost/aic-mcp-test-runner:dev`.

## Report back

Send Claude a line per section ("2 fine", "5: focus ring invisible on the Try-it-out toggle in Firefox"). Failures become fix tasks; passes close the `human_needed` verification statuses.
