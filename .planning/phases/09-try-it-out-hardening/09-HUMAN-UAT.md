---
phase: 09-try-it-out-hardening
status: pending human
---

# Phase 9 Try It Out hardening: Human UAT (pending human)

**E10 update 2026-10-14: the wording defects found by the live run (D5) are fixed in the items below (labels, capability output, podman service PID, compose down networks, Origin header); no item was re-run, so no tick changed.**

**Update 2026-10-14 (E9 live run, Claude with Ville present, rootless Podman 4.9.3, AUTH_ENABLED=false, details in `.planning/exploration/E9-live-podman.md`): items 1-6, 8, 9 were run live; item 7 skipped (needs a paid key).** The note below describes the original state.

Nothing below was run autonomously. The autonomous run used a fake runtime, fake timers and a mocked upstream fetch only; no Podman, Docker or network was touched. Every item is **pending human** and every checkbox is deliberately unchecked.

Notes for a live run on podman 4.9.3 (E10): any `POST` to the dev or compose app needs an `Origin` header equal to `ORIGIN` (SvelteKit CSRF check; compose takes `ORIGIN` from `.env`, for example `http://localhost:5173`), for example `curl -X POST ... -H 'Origin: http://localhost:5173'`. `head -1` of `podman ps` picks the oldest container, which can predate Phase 9 and lack `aic.owner`; pick the container you just warmed (`podman ps --latest`).

Common setup (rootless Podman host, repo root):

```bash
systemctl --user enable --now podman.socket
podman build -t localhost/pi-runner:latest -f Containerfile.pi-runner .
```

Env names used below are from `.env.example`: `PI_RUNNER_NETWORK` (default `aic-pi-internal`), `PI_RUNNER_IMAGE` (`localhost/pi-runner:latest`), `PI_RUNNER_SOCKET`, `PI_RUNNER_IDLE_TTL_MS`, `PI_RUNNER_WARM_WAIT_MS`, `PI_RUNNER_JOB_TIMEOUT_MS`, `PI_JOB_TOKEN_BUDGET`, `PI_JOB_REQUEST_BUDGET`, `PI_RUNNER_MAX_CONTAINERS`, and `APP_INSTANCE_NAME` (owner label, D-017). Pi containers are named `aic-pi-<hex>` and carry label `aic.tryitout=1`, `aic.instance`, `aic.owner`.

## 1. Smoke script after the Phase 9 changes (pending human)

Validates: runtime create options after 09-01 (IN-04 `MemorySwap = Memory`, SEC-13), `.` path rejection, null-prototype getFiles.

```bash
npx tsx scripts/smoke-pi-runner.ts                                  # tmpfs mode
podman-compose up -d --build
npx tsx scripts/smoke-pi-runner.ts --proxy-host aic-agent-library   # DNS + egress checks
```

Expected: every line `PASS` (dns line may `SKIP` without the app running; `external egress blocked` is a `PASS`), final `cleanup: 0 smoke containers left`. If `createAndStart` fails with a memory/swap error, Podman rejected `MemorySwap`: revert the `MemorySwap = Memory` create option (see the 09-01 SUMMARY and D-018).

- [x] tmpfs run all PASS (2026-10-14: 11 lines, dns SKIP as expected, `PASS cleanup: 0 smoke containers left`, 11 s)
- [x] compose run with `--proxy-host aic-agent-library` all PASS (2026-10-14: `PASS dns aic-agent-library: 10.89.0.7`, external egress blocked exit=3, getFiles round trip PASS, cleanup 0 left). Compose needed an override file (`-f podman-compose.yml -f override.yml` with `AUTH_ENABLED: "false"`), app image rebuilt first: 27m48s, image 2.68 GB.

## 2. Container hardening (pending human)

Validates: SEC-13 and the Phase 8 container profile. Start the app, open a runnable agent page (for example `demo-rfi-triage`) to warm a container, then:

```bash
C=$(podman ps --filter label=aic.tryitout --format '{{.Names}}' | head -1)
podman inspect "$C" --format 'user={{.Config.User}} ro={{.HostConfig.ReadonlyRootfs}} capdrop={{.HostConfig.CapDrop}} secopt={{.HostConfig.SecurityOpt}} mem={{.HostConfig.Memory}} swap={{.HostConfig.MemorySwap}} pids={{.HostConfig.PidsLimit}} ports={{.NetworkSettings.Ports}}'
podman inspect "$C" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^(AIC_|OPENAI)'
podman exec "$C" grep -E 'CapEff|CapBnd|NoNewPrivs' /proc/self/status   # expect CapEff=0000000000000000 CapBnd=0000000000000000 NoNewPrivs=1
```

Expected: `user=pi`, `ro=true` (tmpfs mode), `capdrop` printing the full expanded default capability list (podman 4.9.3 expands `ALL` on inspect and does not print `[ALL]`; the real check is the empty effective set below), `secopt` contains `no-new-privileges`, `mem` equals `swap` (default 1073741824), `pids=200`, no published ports; only `AIC_LLM_TOKEN=...` matches the grep and no `OPENAI_API_KEY`.

- [x] all values as expected, with one literal difference. Container `aic-pi-381bccb56cb1`: `user=pi ro=true secopt=[no-new-privileges] mem=1073741824 swap=1073741824 pids=200 ports=map[]`, only `AIC_LLM_TOKEN` in the env grep, no `OPENAI*`. `capdrop` prints the 11 expanded default caps (`[CAP_CHOWN CAP_DAC_OVERRIDE ... CAP_SYS_CHROOT]`), not `[ALL]`: podman 4.9.3 expands ALL on inspect. Effective result verified: `/proc/self/status` `CapEff=0000000000000000 CapBnd=0000000000000000 NoNewPrivs=1`. Note `head -1` picked a pre-Phase-9 container; use the newest one.

## 3. Network guard live (pending human)

Validates: SEC-15/IN-03 (accepted), WR-03 guard.

```bash
C=$(podman ps --filter label=aic.tryitout --format '{{.Names}}' | head -1)
podman exec "$C" node -e "fetch('https://example.com').then(r=>console.log('REACHED',r.status),e=>console.log('BLOCKED',e.cause?.code||e.message))"
podman exec "$C" node -e "fetch('http://aic-agent-library:3000/health').then(r=>console.log('app',r.status),e=>console.log('app BLOCKED',e.message))"
OTHER=$(podman ps --filter label=aic.tryitout --format '{{.Names}}' | sed -n 2p)
[ -n "$OTHER" ] && podman exec "$C" node -e "fetch('http://$(podman inspect "$OTHER" --format '{{(index .NetworkSettings.Networks "aic-pi-internal").IPAddress}}'):3000').then(r=>console.log('peer',r.status),e=>console.log('peer',e.cause?.code||e.message))"
```

Expected: external `BLOCKED` (ENETUNREACH or EAI_AGAIN), app `200`, peer connection refused/timeout (nothing listens in the peer; record the exact result, same-network reachability of peers is not blocked by the engine).

Guard refuses a non-internal network:

```bash
podman network create aic-pi-open
PI_RUNNER_NETWORK=aic-pi-open PI_RUNNER_ALLOW_OPEN_EGRESS=false npx tsx scripts/smoke-pi-runner.ts   # expect FAIL on ensureNetwork: "not internal"
podman network rm aic-pi-open
```

- [x] external blocked, app reachable, peer result recorded: external `BLOCKED ENETUNREACH`, `app 200`, peer (10.89.0.10:3000) `ECONNREFUSED`.
- [x] guard refuses the non-internal network, network removed afterwards: `FAIL ensureNetwork: network "aic-pi-open" is not internal; refusing to run Pi with open egress...`; `podman network rm aic-pi-open` done.

## 4. Orphan sweep owner scoping, WR-08 / SEC-05 (pending human)

Validates: D-017. Two app instances with different owners on one socket.

```bash
APP_INSTANCE_NAME=owner-a npm run dev -- --port 5173 &   # instance A, warm a container via its UI
APP_INSTANCE_NAME=owner-b npm run dev -- --port 5174 &   # instance B, warm another via its UI
podman ps --filter label=aic.tryitout --format '{{.Names}} {{.Labels}}'   # podman 4.9.3: {{.Label "x"}} is invalid; read aic.owner and aic.instance from the map
# restart only instance B, then list again
```

Expected: after B restarts, A's container is still there (different owner); B's previous container (same owner, old instance id) is removed. Containers created before Phase 9 (no `aic.owner` label) survive. Stop both dev servers afterwards.

- [x] A's container survives B restart (owner-a `aic-pi-d9bac4664a30` and the compose-app owner's containers survived)
- [x] B's stale container swept on B restart (owner-b `aic-pi-258bf39e143e` gone after restart; the pre-Phase-9 container without `aic.owner` survived). Spec defect: `{{.Label "aic.owner"}}` is not valid in `podman ps --format` on 4.9.3 (`can't evaluate field Label`); use `{{.Labels}}`. Also `pkill -f` patterns in a shell script can match the script itself.

## 5. Hostile output archive live (pending human)

Validates: SEC-07..SEC-11 (D-018). In a warm container:

```bash
C=$(podman ps --filter label=aic.tryitout --format '{{.Names}}' | head -1)
J=/work/smoke-hostile; podman exec "$C" sh -c "mkdir -p $J/output && ln -s /etc/passwd $J/output/link && head -c 300M /dev/zero > $J/output/big.bin 2>/dev/null; echo hi > $J/output/__proto__"
ps -o rss= -p "$(pgrep -f 'vite|node build' | head -1)"      # note RSS
# trigger the getFiles path for $J/output: run a job, or temporarily point a tsx snippet at createDockerodeRuntime(...).getFiles("$C","$J/output",{maxBytes:20971520,maxFiles:200})
ps -o rss= -p "$(pgrep -f 'vite|node build' | head -1)"      # RSS again
ss -xp | grep -c podman.sock                                  # stream count before/after
```

Expected: the symlink is skipped, the oversized entry is rejected as `output exceeds ... bytes` (the 256 MB work tmpfs may refuse 300 MB first; either outcome is fine), `__proto__` is kept as an ordinary name, app RSS stays roughly flat (no 300 MB jump), and the socket connection count returns to its earlier value (no leaked archive stream).

- [x] symlink skipped, big file rejected: `getFiles(...maxBytes 20971520)` on `aic-pi-381bccb56cb1` gave `REJECTED: output exceeds 20971520 bytes` (big.bin 250 MB; the 256 MB tmpfs refused 300 MB first: `No space left on device`); with big.bin removed: `OK keys: ['__proto__']` (symlink `link` skipped, `__proto__` is an own key on a null-prototype object).
- [x] RSS flat, no leaked stream: tsx process RSS 105 MB before, 107 MB after (+6 s); `ss -xp | grep -c podman.sock` 0 before and 0 after. Caveat: measured in a standalone tsx process through `createDockerodeRuntime`, not inside the app (the app runs in a container here; `pgrep -f 'vite|node build'` on the host would hit an unrelated vite).

## 6. Hung engine live (pending human)

Validates: 09-02 chaos fixes (warm bound, REMOVE_TIMEOUT_MS 15 s, ENGINE_CALL_TIMEOUT_MS 60 s).

```bash
podman info >/dev/null   # wake the socket-activated service first; it idle-exits, so pgrep is usually empty
PID=$(systemctl --user show -p MainPID --value podman.service)
kill -STOP "$PID"       # pause the engine, then open a runnable agent page / start a job
sleep 100               # warm wait (PI_RUNNER_WARM_WAIT_MS=90000 default)
kill -CONT "$PID"
podman ps -a --filter label=aic.tryitout --format '{{.Names}} {{.Status}}'
```

Expected: the UI shows a bounded failure (warm timeout or "container engine error", never an endless spinner); after `kill -CONT` the app recovers and a new job works; no `aic-pi-*` container is left that no lease owns.

- [x] bounded failure while paused: `kill -STOP` on the `podman system service` MainPID (the service is socket-activated and idle-exits, so `pgrep ... | head -1` is usually empty; get the PID with `systemctl --user show -p MainPID --value podman.service` right after a ping). Job `d239ee09...` stayed `claiming container...` for exactly 90 s (08:33:52 to 08:35:22), then `container unavailable, falling back to direct model call` (PI_FALLBACK_ENABLED=true) and ended `succeeded`. App log: `Try It Out warm-up failed: container warm-up timed out`. Never an endless spinner. Note: with the fallback on, the job made a real direct model call (the app's own .env supplies a key).
- [x] recovery and no leaked container after resume: after `kill -CONT` a new job `4b6d383e...` ran in a warm container (`using warm container`, `pi session started`, `succeeded`); later `podman ps -a --filter label=aic.tryitout` showed only containers owned by leases or reaped by TTL.

## 7. Budget enforcement with a real model (pending human, needs OPENAI_API_KEY, user-run only)

Validates: D-016 (reserve-then-reconcile) and 09-03 usage sanitising. This spends real money; use a small model and tiny budgets.

```bash
PI_JOB_TOKEN_BUDGET=3000 PI_JOB_REQUEST_BUDGET=5 npm run dev -- --host
```

Run a job with a long task. Expected: the job ends `failed` with `job token budget exceeded (N tokens, M requests)`, and the provider dashboard shows spend no more than the budget plus one capped completion (4096 tokens).

SKIPPED 2026-10-14 (E9): needs a paid OpenAI key; not run.

- [ ] job stopped with the budget message
- [ ] dashboard spend within budget + one capped completion: ____

## 8. Reaper timing live (pending human)

Validates: chaos.reaper tests against real wall-clock timing.

```bash
PI_RUNNER_IDLE_TTL_MS=15000 npm run dev -- --host      # warm one container via the UI, then:
podman ps --filter label=aic.tryitout --format '{{.Names}}'; sleep 16; sleep 30; podman ps --filter label=aic.tryitout --format '{{.Names}}'
```

Expected: gone within about 16 s plus up to one reaper tick (30 s). Stalled warm: `kill -STOP` the engine mid-create (item 6) and confirm the stuck lease frees its slot within 2x `PI_RUNNER_WARM_WAIT_MS`.

- [x] idle container removed after TTL plus at most one tick (PI_RUNNER_IDLE_TTL_MS=15000, owner-c dev instance: container gone 29 s after creation, bound is 15 + 30 s)
- [x] stalled warm freed within 2x warm wait (PI_RUNNER_WARM_WAIT_MS=5000, PI_RUNNER_MAX_CONTAINERS=1, engine STOPped: a job at t+2 s got `all Try It Out slots are busy`, jobs at t+8 s and t+14 s were admitted, i.e. the slot freed within 2x5 s; after CONT the late create landed as one container under the lease and was reaped by TTL)

## 9. Cleanup after compose down (pending human)

```bash
podman-compose down
podman ps -a --filter label=aic.tryitout
podman network ls | grep aic-pi-internal    # podman-compose 1.0.6 down leaves the networks in place (expected)
podman network rm aic-pi-internal aic-agent-library_default   # removal step; recreated on the next up
podman volume ls | grep -E 'tryout-sessions|auth-data'
```

Expected: no containers with the label; podman-compose 1.0.6 `down` leaves `aic-pi-internal` and `aic-agent-library_default` in place (E10: expectation adjusted, an explicit `podman network rm` removes them); volumes stay (they hold data).

- [ ] (E10: expectation corrected above; not re-run, so left unticked. The E9 observation below matches the corrected expectation: containers PASS, networks left behind by podman-compose 1.0.6.) FAIL (partial) at the time: containers PASS, network FAIL. `podman-compose -f podman-compose.yml -f override.yml down` (2.4 s, podman-compose 1.0.6) stopped and removed `aic-agent-library`; `podman ps -a --filter label=aic.tryitout` empty (the app's graceful shutdown also removed its warm Pi container). But `podman network ls` still lists `aic-pi-internal` and `aic-agent-library_default`: podman-compose 1.0.6 `down` does not remove networks (the compose file declares `aic-pi-internal` with an explicit name). Volumes `aic-agent-library_tryout-sessions` and `aic-agent-library_auth-data` stayed, as expected. Either the Expected text should say the network stays (the app recreates it idempotently, smoke `ensureNetwork` PASS), or the runbook should add `podman network rm aic-pi-internal`.

## Known accepted risks

Copied from `09-SECURITY-REVIEW.md` so they are reviewed in one place:

- SEC-06 client limit: the per-client key depends on adapter `ADDRESS_HEADER`/XFF configuration; trust is deployment configuration; the table is bounded (10k).
- SEC-15 / IN-03: Pi containers can reach the whole app on the internal network `aic-pi-internal` (deliberate D-19 second-network design; an nginx relay exposing only `/api/llm/` is the documented alternative).
- Network verification is cached for the process lifetime: a network later recreated non-internal is not noticed until restart.
- The per-lease token is visible in container Env to anyone with engine socket access (same trust domain).
- Bearer parsing is stricter than RFC (case-sensitive `Bearer `); stricter is safe.
- Operator note: set `APP_INSTANCE_NAME` in compose deployments, or the hostname fallback changes with every container recreation and leftovers are not swept.
- From Phase 9 chaos work: while an evicted lease's container is still being removed the engine can briefly hold more than `PI_RUNNER_MAX_CONTAINERS` containers (cap counts leases); a hung `remove` is abandoned after 15 s and left to the orphan sweep.


## Compose override used by the live run (2026-10-14)
`podman-compose -f podman-compose.yml -f override.yml ...` with this `override.yml` (disables auth for a local run; the file is not committed):
```yaml
services:
  aic-agent-library:
    environment:
      AUTH_ENABLED: "false"
```
The ordered, corrected step list for all of these checks is in `docs/human-verification-guide.md` section 8.
