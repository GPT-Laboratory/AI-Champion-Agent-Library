# Deploy runbook

Operator guide for building, starting, checking and rolling back the AIC Agent Library. Everything here is derived from `package.json`, `Containerfile`, `podman-compose.yml`, `.env.example` and the code (variable names are grep-verified against `src/` and `scripts/`). Nothing in this file has been run against a real host.

> **Build status.** `npx vite build` succeeds on this branch (B-002, a route-module export error, is fixed and guarded by `src/routes/routeExports.test.ts`). The Containerfile image build itself has still never been run here (pending human).

## 1. Prerequisites

- Node.js 22 (the Containerfile uses `node:22-bookworm-slim`; the Pi and MCP-test runner images need Node >= 22.19).
- For the container route: rootless Podman with `podman-compose` and an active user socket (`systemctl --user enable --now podman.socket`). Compose always mounts the socket, including when `PI_RUNNER_ENABLED=false`.
- `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` on every `npm install` / `npm ci`. Without it the onnxruntime-node postinstall hangs on a CUDA download.

## 2. Build steps (bare metal)

```bash
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci
mkdir -p db
npm run db:push           # drizzle-kit push: creates/updates db/catalog.db (agents, agent_embeddings, agent_kinds)
npm run ingest            # data/agents/*.yaml -> SQLite (+ embeddings, see below)
npm run tryout:configure  # sets try_it_out_mode: demo-rfi-triage = runnable, hvac-load-calculator = none
npx vite build            # server bundle in build/
node --env-file=.env build # production server (PORT, default 3000)
```

`npm run build` runs `db:push`, `ingest`, `tryout:configure` and `vite build` in that order. `tryout:configure` fails if the two slugs are missing, so run it after `ingest`.

### Ingest and embeddings

- `SEARCH_EMBEDDINGS=off` skips the embedding model entirely: ingest writes no vectors and search is keyword (BM25) only. The server also skips the warm-up. Use it for CI, offline builds and first smoke tests.
- Otherwise ingest downloads `Xenova/all-MiniLM-L6-v2` (about 90 MB, about 90 s) once into `HF_CACHE_DIR` (default `./db/models`). Without network it logs a warning and the app runs BM25-only; this is by design. Embeddings are skipped for agents whose text hash has not changed.
- The model cache lives under `db/models`, so copying or backing up `db/` carries it.
- `INGEST_DATA_DIR` (default `./data/agents`) and `INGEST_DB_PATH` (default `./db/catalog.db`) override the ingest source and target. `CATALOG_DB_PATH` selects the DB the server and `tryout:configure` use.
- With `AGENT_KINDS` on, re-run `npm run ingest` (the flag changes what ingest reads, including sub-directories under `data/agents/`).

## 3. Environment variables and flags

Defaults are read from the code. "unset" means the feature is off or the value comes from elsewhere as noted.

### Feature flags (truthy values for the first three: `1`, `true`, `on`, `yes`, case-insensitive; all default off)

| Variable | Default | Effect |
|---|---|---|
| `AGENT_KINDS` | off | Multi-agent and multi-format hosting (kind badge, Type filter, `?kind=`, system detail page). Needs a re-ingest. Toggling it in either direction also needs a re-ingest for the semantic search leg: embedding hashes include the kind text, so stale vectors are rebuilt only by ingest. |
| `AGENT_COMPARE` | off | Side-by-side comparison: `/compare?agents=a,b` (404 when off) and compare checkboxes on catalog cards. Read at request time; no re-ingest. |
| `UI_SPEC_VIEWER` | off | Read-only raw spec viewer on the agent detail page (`/agents/[slug]`). Text is escaped, never rendered as HTML. |
| `UI_DARK_MODE` | off | Dark/light theme toggle in the header and the dark palette. |
| `MCP_GENERATOR` | off | "Generate MCP" panel and `POST /api/mcp-generate`. The CLI works without it. |
| `MCP_GENERATOR_RATE_MAX`, `MCP_GENERATOR_RATE_WINDOW_SEC`, `MCP_GENERATOR_MAX_CONCURRENT` | `20`, `600`, `2` | Abuse limits of `POST /api/mcp-generate` (D-465): requests per client address per window, and simultaneous generations. `0` disables a limit. Over a limit the route answers 429 `{ message }` with `Retry-After`. In-memory, per process. Behind a reverse proxy every client may share one address; size the limits for that. |
| `MCP_TESTER` | off | `/mcp-test` page and `/api/mcp-test/runs` routes. The CLI works without it. |
| `MCP_TESTER_RUNTIME` | unset (in-process fakes) | Literal `container` runs the MCP tester in the runner image through the container runtime. Operator-set only. |
| `SEARCH_EMBEDDINGS` | on | Only the literal `off` disables embeddings (ingest, warm-up, search). |
| `SEARCH_REAL_EMBEDDINGS` | unset | Test-only: `1` un-skips `src/lib/server/search/accuracy.real.test.ts` (downloads the model). Never set in deployments. |

### Core, auth and mail

| Variable | Default | Notes |
|---|---|---|
| `PORT`, `HOST` | `3000`, `0.0.0.0` (image) | adapter-node |
| `ORIGIN` | none; compose default `http://localhost:3000` | Public base URL for SvelteKit's CSRF origin check. Must match the public URL. |
| `CATALOG_DB_PATH` | `./db/catalog.db` (image `/app/db/catalog.db`) | |
| `HF_CACHE_DIR` | `./db/models` (image `/app/db/models`) | Embedding model cache |
| `AUTH_ENABLED` | enabled | Only `false` disables sign-in |
| `AUTH_ALLOWED_EMAILS`, `AUTH_ALLOWED_EMAIL_DOMAINS` | empty | Comma-separated allow-lists |
| `AUTH_DB_PATH` | `runtime/auth/auth.db` (image `/app/runtime/auth/auth.db`) | Sessions, login codes, rate limits |
| `AUTH_COOKIE_SECURE` | secure when the request URL is https | `true` forces, `false` disables |
| `BREVO_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_EMAIL_FROM_NAME` | none | Default mail transport |
| `SMTP_SERVER`, `SMTP_PORT` | none, `25` | Plain-TCP relay; overrides Brevo when set |

### Try It Out (container runner and direct model call)

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_API_KEY` | none | Used by the direct model call and the LLM proxy. Never given to containers. |
| `PI_LLM_UPSTREAM_URL` | `https://api.openai.com/v1` | Upstream of the proxy `/api/llm/v1` |
| `PI_LLM_PROXY_URL` | `http://aic-agent-library:3000/api/llm/v1` | How Pi containers reach the app (compose pins its own) |
| `PI_RUNNER_ENABLED` | enabled | Only `false` disables the container runner |
| `PI_FALLBACK_ENABLED` | enabled | Only `false` stops falling back to the direct call when the engine is unreachable |
| `PI_RUNNER_IMAGE` | `localhost/pi-runner:latest` for local development | Production `deploy.sh` builds and exports a unique release tag from `Containerfile.pi-runner` |
| `PI_RUNNER_SOCKET` | `$XDG_RUNTIME_DIR/podman/podman.sock`, else `/run/podman/podman.sock` | |
| `PI_RUNNER_NETWORK` | `aic-pi-internal` | Must be an internal network |
| `PI_RUNNER_ALLOW_OPEN_EGRESS` | `false` | Only the literal `true` allows a non-internal network. Dev only. |
| `PI_RUNNER_FS_MODE` | `tmpfs` | `tmpfs` or `layer` |
| `PI_RUNNER_TOOLS` | `read,write,edit,grep,find,ls` | Subset of `read,write,edit,bash,grep,find,ls` |
| `PI_RUNNER_MAX_CONTAINERS` | 5 | 1 to 50 |
| `PI_RUNNER_ANON_SESSIONS_PER_CLIENT` | 5 per 10 min | 0 = unlimited (relevant when `AUTH_ENABLED=false`) |
| `PI_RUNNER_IDLE_TTL_MS`, `_MIN_IDLE_MS`, `_WARM_WAIT_MS`, `_JOB_TIMEOUT_MS` | 300000, 60000, 90000, 300000 | |
| `PI_RUNNER_MEMORY_MB`, `_CPUS`, `_PIDS` | 1024, 0.5, 200 | |
| `PI_RUNNER_WORK_TMPFS_MB`, `_TMP_TMPFS_MB`, `_AGENT_TMPFS_MB` | 256, 64, 16 | |
| `PI_JOB_TOKEN_BUDGET`, `PI_JOB_REQUEST_BUDGET` | 100000, 40 | Per job, enforced by the proxy |
| `TRYITOUT_USAGE_ENDPOINT` | unset (off) | Diagnostic, off by default; `1` enables `/api/tryitout/jobs/:id/usage`, which returns token counts only |
| `PI_RUNNER_MAX_OUTPUT_BYTES`, `_MAX_OUTPUT_FILES` | 20971520, 200 | Output zip limits |
| `APP_INSTANCE_NAME` | `aic-agent-library` in `podman-compose.yml` (container hostname if unset elsewhere) | Owner label (`aic.owner`) on every runner container. The start-up orphan sweep removes only same-owner leftovers. Set a stable value such as `aic-prod`; the compose file does not set it yet. |
| `TRYITOUT_WORK_DIR` | `./.tryitout-work` (image `/app/runtime/tryitout-work`) | Job working files |
| `TRYITOUT_PROMPTS_DIR` | `./data/tryitout-prompts` | Agent skill/prompt files (shipped in the image) |
| `TRYOUT_STORAGE_PATH`, `TRYOUT_TEMPLATE_PATH` | `./runtime/try-out-sessions`, `./data/try-out/prompt-template.txt` | Legacy `/api/try-out` route |
| `XDG_RUNTIME_DIR` | set by the host session | Required and non-empty for Compose; locates the deployment user's rootless Podman socket on the host |

### Errors and support references

API error bodies are JSON with a `message` field (D-461). An unexpected server error shows the visitor a fixed message and `Reference: <8 hex chars>` (D-462); the same reference is in the server log line `[ref <id>] METHOD /path failed (status):` followed by the redacted error and stack. Ask the visitor for the reference and grep the log for it. Logs never contain secrets matching the shared token patterns.

### MCP test runner (only with `MCP_TESTER=1` and `MCP_TESTER_RUNTIME=container`)

| Variable | Default | Notes |
|---|---|---|
| `MCPTEST_RUNNER_IMAGE` | `localhost/mcp-test-runner:latest` | From `Containerfile.mcp-test-runner` (not yet built or run: pending human) |
| `MCPTEST_NETWORK` | `aic-mcptest-internal` | Internal network, no egress |
| `MCPTEST_JOB_TIMEOUT_MS` | 300000 (runner default) | Passed as `PI_RUNNER_JOB_TIMEOUT_MS` |
| `MCPTEST_MEMORY_MB` | 1024 (runner default) | Passed as `PI_RUNNER_MEMORY_MB` |
| `MCPTEST_ALLOW_OPEN_EGRESS` | n/a | Setting it to `true` or `1` makes the config throw: the runner never gets egress |
| `MCPTEST_IN`, `MCPTEST_OUT`, `MCPTEST_PKG_ROOT` | set by the platform | In-container driver only; do not set by hand |

### Scripts only

`SCALE_COUNT` (150), `SCALE_SEED` (20260101), `SCALE_OUT_DIR` (`./data/fixtures-scale`) for `npm run fixtures:scale`.

## 4. Containers

Files: `Containerfile` (app, multi-stage), `Containerfile.pi-runner` (generic Pi image, `@earendil-works/pi-coding-agent@1.0.4`), `Containerfile.mcp-test-runner` (definition only; runs as user `pi`, uid 1000, like the Pi runner, D-464), `podman-compose.yml`, `.containerignore`.

```bash
# First installation only: copy .env.example to .env and replace placeholders.
# On upgrades, preserve the existing .env.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
systemctl --user enable --now podman.socket || exit 1
test -S "$XDG_RUNTIME_DIR/podman/podman.sock" || {
    echo "Missing Podman socket: $XDG_RUNTIME_DIR/podman/podman.sock" >&2
    exit 1
}
bash ./deploy.sh              # builds both release images, validates, replaces, checks, rolls back
```

Run the commands above as the same dedicated, non-root user that owns the
application containers, without `sudo`. The export applies to the current shell;
any deployment script or service must also supply that user's `XDG_RUNTIME_DIR`.

For an unattended server, an administrator can enable the deployment user's
systemd user manager at boot and after logout with
`sudo loginctl enable-linger <deployment-user>`. This keeps the enabled user
socket available; it does not itself configure the app containers to start at boot.

### Socket startup errors

- `XDG_RUNTIME_DIR must be set ...`: Compose stopped before creating the app.
  Export the runtime directory as shown above in the shell that invokes Compose.
- `statfs /podman/podman.sock: no such file or directory` with an older compose
  file: the variable expanded to an empty string. Update the file and set the variable.
- `statfs /run/user/.../podman/podman.sock: no such file or directory`: the path
  is set, but the socket is missing. Check `systemctl --user status podman.socket`
  and confirm the path belongs to the current deployment user. Do not create a
  directory or regular file in place of the socket.
- `Failed to connect to bus` from `systemctl --user`: log in directly over SSH as
  the deployment user and retry; a session entered through `su` or `sudo` may lack
  the user manager environment.
- `no container with name or ID "aic-agent-library" found` after a mount error:
  container creation failed; fix the first error and run Compose again.

`PI_RUNNER_SOCKET` is the app's path inside the container, pinned by Compose to
`/run/podman/podman.sock`. Changing it in `.env` does not change the host mount.
`PI_RUNNER_ENABLED=false` and `PI_FALLBACK_ENABLED=true` do not bypass the mount
requirement, since mounts are prepared before the app can start.

Notes from the files:

- The app image bakes `db/catalog.db` at build time (`drizzle-kit push --force`, `npm run ingest`, `npm run tryout:configure`, `vite build`, then a `SELECT` sanity check). To pick up new or changed agent YAML, rebuild the image. With no network at build time the image runs BM25-only. The model cache is copied with `db/` (`HF_CACHE_DIR=/app/db/models`).
- The runtime image runs as user `node`, ships production dependencies only (`npm prune --omit=dev`), and has a `HEALTHCHECK` against `/health`.
- Compose volumes: `auth-data` (`/app/runtime/auth`, login state), `tryout-sessions` (`/app/runtime/tryitout-work`). The host Podman socket is mounted at `/run/podman/podman.sock`; `userns_mode: keep-id:uid=1000,gid=1000` and `security_opt: label=disable` make it usable. Mounting the socket gives the app control over that host user's containers: use a dedicated user.
- Compose pins `PI_RUNNER_NETWORK=aic-pi-internal` (an `internal: true` network where the app has the alias `aic-agent-library`), `PI_LLM_PROXY_URL=http://aic-agent-library:3000/api/llm/v1` and `PI_RUNNER_ALLOW_OPEN_EGRESS=false`. `deploy.sh` always exports its newly built `PI_RUNNER_IMAGE`, overriding inherited shell values and env-file interpolation values. `PI_RUNNER_FS_MODE` (`tmpfs`) and `PI_FALLBACK_ENABLED` (`true`) remain configurable.
- Run a single app replica per engine user: the orphan sweep at start-up assumes it. Set `APP_INSTANCE_NAME` (for example `aic-prod`) in `.env` or the compose environment so containers carry a stable owner label; otherwise the hostname changes whenever the container is recreated and leftovers are not swept.
- Resource limits need cgroup v2 delegation for rootless Podman.

## 5. Try It Out runtime requirements

- A release-specific Pi runner image built by `deploy.sh` in the deployment user's image storage; Podman socket enabled for that same user. No production dependency on `latest`.
- `OPENAI_API_KEY` set in `.env` (stays in the app; containers get a per-lease token and call the proxy).
- `npx tsx scripts/smoke-pi-runner.ts` (add `--proxy-host aic-agent-library` once the app is up) shows which `PI_RUNNER_FS_MODE` the host supports. It starts containers: run it only on the intended host.
- Only agents with `try_it_out_mode = 'runnable'` show the panel; `tryout:configure` sets that for `demo-rfi-triage`. If the engine is unreachable the job falls back to the direct model call (`PI_FALLBACK_ENABLED`).
- Job metadata is in memory; job links do not survive a restart.
- With `AGENT_KINDS` on, the job routes (403) and the prompt loaders refuse non-agent kinds.

### Runner image validation and missing-image diagnosis

`deploy.sh` always builds the Pi image before the app image and before stopping
the existing app. It inspects the runner locally, then runs
`deploy/validate-runner.cjs` in the new app image with the same socket mount,
user mapping and SELinux option used by Compose. The validator inspects the exact
release tag through dockerode and compares its image ID with the CLI's result.
This catches a missing image, an inaccessible socket, or different image stores.
After Compose starts the app, the validator runs again inside it, checking its
actual `PI_RUNNER_IMAGE` and `PI_RUNNER_SOCKET`. A failure triggers rollback and
does not record a successful deployment. No images are built by normal app runtime.
These checks establish configuration and API visibility; a real Try It Out smoke
test is still needed to establish container execution and upstream LLM access.

The service `env_file` supplies container defaults; the Compose `environment`
mapping overrides those values. For interpolation, `deploy.sh` exports the release
image in its process environment and passes the selected `APP_ENV_FILE` explicitly
with `--env-file`. It never sources the file as shell code. Direct Compose runs
without these exports can select the local `latest` fallback, or a stale value
from an env file. Such runs are not the production release path.

Run these read-only diagnostics in a direct SSH session as the existing rootless
Podman owner (example paths below assume `deploy`; adapt to the installed unit).
Do not dump the complete container environment or rendered Compose config into
shared logs because they contain secrets.

```bash
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
id
podman info --format '{{.Store.GraphRoot}}'
systemctl --user status podman.socket --no-pager
cat /home/deploy/.local/state/aic-deploy/release
cat /home/deploy/.local/state/aic-deploy/current
git -C /home/deploy/app rev-parse HEAD
podman inspect --format '{{.ImageName}} {{.Image}}' aic-agent-library
runner_image=$(podman exec aic-agent-library node -p 'process.env.PI_RUNNER_IMAGE || ""')
printf 'Running app runner image: %s\n' "$runner_image"
test -n "$runner_image" && podman image inspect --format '{{.Id}}' "$runner_image"
podman images --filter reference='localhost/pi-runner:*'
podman exec aic-agent-library node -e '
  const Docker = require("dockerode");
  const image = process.env.PI_RUNNER_IMAGE || "localhost/pi-runner:latest";
  const socketPath = process.env.PI_RUNNER_SOCKET || "/run/podman/podman.sock";
  console.log({ image, socketPath });
  new Docker({ socketPath, timeout: 10000 }).getImage(image).inspect()
    .then(info => console.log({ id: info.Id }))
    .catch(error => { console.error(error.message); process.exitCode = 1; });'
```

An administrator can also read the deployment log and installed service settings:

```bash
sudo journalctl -u autodeploy.service -n 150 --no-pager
systemctl show autodeploy.service -p User -p Group -p EnvironmentFiles -p ExecStart
sudo cmp /usr/local/bin/autodeploy /home/deploy/app/deploy/autodeploy
```

Compare the commit in `release` and `current` with the checkout and the app's
image tag (a checkout may be ahead after a failed deployment). The image suffix
is `<commit>-<timestamp>-<pid>`, not the Git version tag; app and runner should
share that suffix. `latest` in app logs does not match the current deploy script's
release export. An older signed release, direct Compose/manual startup, or an
older installed poller is a hypothesis until the above evidence confirms it.
An image built under root or another rootless user is not available to this user.
CLI success combined with API failure suggests a different engine/storage or
socket permissions; the socket-based check is decisive for the application.

Remediation follows the signed-tag process in [autodeploy.md](autodeploy.md):
merge the fix to `main`, publish a new higher SSH-signed annotated tag, and let
the existing timer verify and deploy it. Do not move old tags, edit deployment
state to force a retry, or build a `latest` alias. The poller skips a tag already
recorded as successful; restarting the poller alone will not redeploy that tag.
If the required release-specific image is present and only the server launch
configuration is wrong, correct that configuration during an approved maintenance
window, then deploy through the same verified release path. This repository
change does not require reinstalling the root-owned poller or systemd units.

## 6. Backups

- `db/` holds `catalog.db` (rebuildable from `data/agents/` with `npm run ingest`, so a backup is a convenience) and `db/models` (rebuildable, about 90 MB download).
- The data that cannot be rebuilt is the auth database (`runtime/auth/auth.db`, in the `auth-data` volume): sessions, rate limits and the `login_code_recipients` table. Back it up with SQLite's online backup (`sqlite3 auth.db ".backup out.db"`), or with the app stopped; the database may use WAL, so never copy only the main file of a running instance.
- Back up `.env` separately and securely (it contains keys); it is gitignored and never copied into the image.

## 7. Health check

- `GET /health` returns `{"status":"ok"}` (200) and is public even when sign-in is required. It answers 503 `{"message":"Service unavailable"}` when the database cannot be read or the `agents` table is missing (D-460); no cause is exposed, so check the container log. The image `HEALTHCHECK` calls it every 30 s.
- It proves the process serves HTTP and the catalog database is readable. Also check `/catalog` (needs sign-in unless `AUTH_ENABLED=false`) and, after start, the container log for `Try It Out service failed to start` or `Search warm-up failed` warnings (both non-fatal).
- Pre-release runtime check: `npm run smoke` builds the server and probes it across all flag configurations (see `docs/smoke-test.md`).

## 8. Rollback

1. Features: unset `AGENT_KINDS`, `MCP_GENERATOR`, `MCP_TESTER`, `MCP_TESTER_RUNTIME` (or set `0`) and restart. Flag-off behaviour is pinned byte-identical by `scripts/flag-off.golden.test.ts`. The `agent_kinds` table is a sidecar and can stay.
2. Try It Out: `PI_RUNNER_ENABLED=false` (direct call only).
3. Search: `SEARCH_EMBEDDINGS=off` and restart for keyword-only search.
4. Code in signed-tag production: `git revert <commit>` on `main` through review, then publish a new higher signed tag as described in `docs/autodeploy.md`. Deployment builds both images and preserves the prior container for rollback on failure. Keep database changes backward compatible; container rollback does not undo shared volume changes.
5. Dependencies: see `docs/dependency-health.md` and D-253 in `.planning/AUTONOMOUS-DECISIONS.md` (revert the dependency commit, then `npm ci`).
6. Leftover containers: with the same `APP_INSTANCE_NAME` the next start sweeps them; otherwise list with `podman ps --filter label=aic.owner` and remove by hand (only on the intended host).

## 9. Pending-human live checks

Nothing below has been done. Each file is an unchecked checklist.

| Phase | What needs a human | File |
|---|---|---|
| 2 | Browser check of catalog and detail pages (plan 02-04, not executed; Phase 2 is not complete) | `.planning/phases/02-catalog-and-detail/02-04-PLAN.md` |
| 3 Search | Real-model accuracy run, SIM_FLOOR tuning, real-embedding ingest, live-typing feel | `.planning/phases/03-search/03-HUMAN-UAT.md` |
| 4 Customize placeholder | Browser check of the Customize menu | `.planning/phases/04-customization-placeholder/04-HUMAN-UAT.md` |
| 9 Try It Out hardening | Nine live Podman checks (smoke, hardening inspect, network guard, owner-scoped sweep, hostile archive, hung engine, budget, reaper, cleanup) | `.planning/phases/09-try-it-out-hardening/09-HUMAN-UAT.md` |
| 10 Accessibility | Keyboard walk, screen readers, focus ring, zoom, real-browser contrast, reduced motion | `.planning/phases/10-accessibility-ui-03/10-HUMAN-UAT.md` |
| 11 Related agents | Browser check and real-catalog suggestion quality | `.planning/phases/11-related-agents-disc-01/11-HUMAN-UAT.md` |
| 13 Multi-format hosting | Browser checks with `AGENT_KINDS=1` | `.planning/phases/13-multi-agent-and-multi-format-hosting-flagged/13-HUMAN-UAT.md` |
| 14 MCP generator | fastmcp pin check on PyPI, run a generated server, CLI per fixture, panel and zip download | `.planning/phases/14-mcp-generator-generalized-from-research-flagged/14-HUMAN-UAT.md` |
| 15 MCP test platform | Runner image build, container run, real FastMCP comparison, auth hook check, browser checks | `.planning/phases/15-mcp-test-platform-flagged/15-HUMAN-UAT.md` |

Phases 1, 2.1, 2.2, 5, 6, 7, 8 and 12 are verified `passed`. The first production container build is a human step.

For the shared deployment script and signed-tag timer, see [autodeploy.md](autodeploy.md).
