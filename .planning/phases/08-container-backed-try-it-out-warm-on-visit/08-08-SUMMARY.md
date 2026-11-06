---
phase: 08-container-backed-try-it-out-warm-on-visit
plan: 08
status: complete
subsystem: deployment
tags: [podman, containerfile, compose, smoke]
requires: ["08-01", "08-05", "08-06", "08-07"]
provides:
  - Containerfile.pi-runner generic Pi image
  - scripts/smoke-pi-runner.ts live engine check
  - compose socket mount and internal network, PI_* docs
key-files:
  created: [Containerfile.pi-runner, scripts/smoke-pi-runner.ts]
  modified: [podman-compose.yml, Containerfile, .env.example, README.md]
---

# Phase 8 Plan 08: pi-runner image, compose wiring and smoke script

Status: complete. Tasks 1 and 2 are done and committed. Task 3 (live verification on a Podman host) was run and approved by the user on 2026-10-12 with `approved fs-mode=tmpfs`. Live verification was run on 2026-10-12 on rootless Podman 4.9.3 (Linux Mint 22.3, Ubuntu 24.04 base, cgroup v2, netavark, crun); results are in "Live verification" below. The compose-with-socket run is still open, 

## Completed

- Task 1 (404ce69): `Containerfile.pi-runner` (Pi 1.0.4 pinned, `--ignore-scripts`, user pi uid 1000, ripgrep/fd, PI_OFFLINE/PI_SKIP_VERSION_CHECK/PI_TELEMETRY set, no COPY, no secrets) and `scripts/smoke-pi-runner.ts` (drives the production dockerode runtime; `--help` and engine_unavailable exit 1 verified locally).
- Task 2 (see git log, feat(08-08) wire Podman socket): compose socket mount, `label=disable`, keep-id userns, `aic-pi-internal` internal network with alias `aic-agent-library`; `PI_RUNNER_SOCKET` in app Containerfile; `.env.example` PI_* block; README "Trying out an agent" rewritten plus "Setting up the Pi runner".

## Gate results

- vitest excluding set-try-it-out-mode: 38 files, 380 tests passed.
- set-try-it-out-mode baseline: exactly 3 failures (as expected).
- `npm run build` ok; build/client contains neither OPENAI_API_KEY nor dockerode.
- `npx tsc --noEmit`: only the 22 pre-existing errors in catalog.test.ts, tryItOut.test.ts, detail.test.ts, try-it-out.test.ts (out of scope, not fixed). No errors in new files. The plan's literal `npx tsc --noEmit` step therefore exits non-zero for pre-existing reasons only.

## Deviations

None in scope. (A self-introduced type error in the smoke script was fixed before committing.)

## Pending: Task 3

Human must run the plan's "how-to-verify" steps 1-11 on a rootless Podman host with a real OPENAI_API_KEY, then record the smoke output and the RECOMMENDED PI_RUNNER_FS_MODE here. If the result is `layer`, change the compose default to `${PI_RUNNER_FS_MODE:-layer}` and update the .env.example comment.

## Live verification (2026-10-12, rootless Podman 4.9.3, host Linux Mint 22.3)

Passed:
- Image builds (`localhost/pi-runner:latest`, 387 MB). `scripts/smoke-pi-runner.ts` passes every step in **`PI_RUNNER_FS_MODE=tmpfs`** (the preferred mode, so no `layer` fallback is needed): ping, internal network, create, putFiles into tmpfs and a read-only rootfs, `pi --version` offline (1.0.4), exec demux and exit code, external egress blocked on `aic-pi-internal`, timeout kill (exit 137), getFiles round trip, cleanup. DNS to the app alias skipped (needs the compose run).
- Dev mode (`npm run dev -- --host`, Podman socket from `$XDG_RUNTIME_DIR`): opening `/agents/demo-rfi-triage` starts one `aic-pi-*` container; a reload adds none. A job with the sample RFI succeeds (real Pi tool events in the feed, `agent settled (clean exit)`), the download is `application/zip` containing `result.txt`, a second job reuses the same container.
- `podman inspect`: user pi, `ReadonlyRootfs=true`, all capabilities dropped, `no-new-privileges`, Memory 1073741824, NanoCpus 500000000, PidsLimit 200, no published ports, tmpfs `/work` 256m, `/tmp` 64m, agent dir 16m; the container env holds only `AIC_LLM_TOKEN` (no OpenAI key); `models.json` points at the app proxy.
- Fallback: with the Podman socket stopped, the job falls back to the direct model call (feed says so, warning logged) and still returns a zip with `result.txt`.
- Idle TTL: with `PI_RUNNER_IDLE_TTL_MS=15000`, the container was removed 16 s after the job finished (reaper interval 30 s).
- Restart cleanup: after a SIGKILL crash the orphan container stays up, and is removed at the next start (orphan sweep). With a graceful SIGTERM, the production build (`node build`) removed the container within about 1 s; under `vite dev` the container survives SIGTERM (Vite exits first) and is swept at the next start.

Defects found by the live run and fixed: `e396564` (Podman rejects tmpfs `uid=`/`gid=` options; agent dir now `mode=1777`), `f1a0dfa` (Vite `allowedHosts` for `host.containers.internal`; proxy token store on globalThis so a dev reload cannot drop tokens), `50187b4` (reload-safe `isTryItOutRuntimeError` so the D-14 fallback survives a dev reload; proxy test isolated from a developer's real `.env`).

Compose run (also 2026-10-12, `podman-compose` 1.0.6 from apt, `podman-compose up -d --build`): passed.
- App image builds and starts; no `EACCES`: with `userns_mode: keep-id:uid=1000,gid=1000` and `label=disable` the `node` user in the app container reads the mounted host socket (`/run/podman/podman.sock`).
- App is attached to `aic-agent-library_default` and `aic-pi-internal` (alias `aic-agent-library`). `scripts/smoke-pi-runner.ts --proxy-host aic-agent-library` now passes every step including DNS (alias resolves to the app container).
- Opening `/agents/demo-rfi-triage` on port 3000 started a Pi container on `aic-pi-internal` only; a job completed through the internal network (real model call via the proxy, real Pi tool events, zip with `result.txt`).
- From the live warm container: `https://api.openai.com` fails with `ENETUNREACH` (no internet), `http://aic-agent-library:3000/health` returns 200.
- `podman-compose down` (SIGTERM to the app) left 0 `aic.tryitout` containers.
- Finding fixed: podman-compose lets a developer's `.env` override the interpolated defaults, so dev-only values (`PI_LLM_PROXY_URL=http://host.containers.internal:5173/...`, `PI_RUNNER_ALLOW_OPEN_EGRESS=true`) leaked into the compose stack. `podman-compose.yml` now pins `PI_LLM_PROXY_URL` to the internal alias and `PI_RUNNER_ALLOW_OPEN_EGRESS` to false. `ORIGIN` must match the public URL (`http://localhost:3000` for compose); a dev-only value in `.env` makes the CSRF check reject POSTs.

Task 3 sign-off: the user approved with `approved fs-mode=tmpfs` after also running the browser flow themselves (warm on visit, job with Pi tool events, zip download, container reuse, and the direct-model fallback when the engine socket was off and a new session was used). One observation from their run: a job in a session that already holds a warm container, with the engine stopped afterwards, fails with `ECONNREFUSED` instead of falling back (by design: only claim-phase failures fall back, D-14).

Fixed after sign-off: a job without an upload no longer makes Pi read the absent `input/upload.txt` (the runner's instruction now names only staged files).
