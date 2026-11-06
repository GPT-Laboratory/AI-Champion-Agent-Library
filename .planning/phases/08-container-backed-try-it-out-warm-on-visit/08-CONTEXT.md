# Phase 8: Container-backed Try It Out (warm on visit) - Context

**Gathered:** 2026-10-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Opening a runnable agent's detail page warms a Podman container running the Pi coding agent with that agent's skill. Try It Out then runs the job in that container, behind the existing, unchanged job API (`submitJob`/`subscribeProgress`/`downloadArtifact` in `src/lib/tryItOut.ts`, `docs/job-api-contract.md`). This replaces the body of the Phase 7 direct-LLM runner (`src/lib/server/tryItOutRunner.ts`), which survives only as a configurable fallback.

Delegated by Jussi Rasku (messages of 6.10.): "when someone browses to the page, we start warming a container that has Pi and the skill." The GAISE workshop platform (`GPT-Laboratory/GAISE26_tool_building_pi_agents`) is the source of the idea only. Borrow the pattern (warm pool, resource limits, non-root, no published ports), not the code, and not its browser-terminal (tmux/ttyd) layer.

Not in this phase: per-agent images, structured `inputSchema` forms through the job API, human-approval steps, per-user job persistence, the AIRO/ChatGPT-hosted agents (they have no runnable mode).

</domain>

<decisions>
## Implementation Decisions

### Launching containers
- **D-01:** The app (itself a Podman container in deployment: `Containerfile`, `podman-compose.yml`) starts Pi containers by mounting the host's Podman socket into the app container and calling its Docker-compatible API. — **Reversibility:** costly — **rationale:** the socket mount, compose file, and the container-manager module all assume it; switching to a host-run app or a separate runner service touches deployment and the manager's transport. Security note: socket access gives the app control of host containers, hence D-17 to D-22.
- **D-02:** One generic `pi-runner` image with Pi installed. The agent's skill is mounted/copied in at start (from `data/tryitout-prompts/<slug>/`). Adding a runnable agent means adding a skill folder, not building an image.
- **D-03:** Local dev (`npm run dev`, no app container) uses the same code path against the developer's own rootless Podman socket (`$XDG_RUNTIME_DIR/podman/podman.sock`). One code path; developers need Podman running locally.
- **D-04:** The server talks to the engine with `dockerode` over the socket (same library as GAISE `backend/src/pool.ts`), not by shelling out to the `podman` CLI.

### Warm-up lifecycle
- **D-05:** Trigger = opening the agent detail page (`/agents/<slug>`) of a runnable agent. Warm-up runs in the background and must not block page render.
- **D-06:** One container per visitor session. Maximum **one** warm container per session: a new page (another agent) in the same session replaces it.
- **D-07:** A container is reused for several jobs, one after another, with a fresh work dir per job. Idle TTL is ~5 minutes (supersedes the ~10 minutes first proposed); the exact value is configurable.
- **D-08:** Lease state machine: `warming → idle → claimed → running` (and back to `idle` after a job, then `expired`/removed). Eviction is allowed only from `idle`, performed via an atomic compare-and-set, so a concurrent claim can never race an eviction.
- **D-09:** Global cap on containers (small, configurable; ~5 for the prototype). At the cap, evict the oldest-idle container first, but only one idle for at least ~60 s (minimum idle age, to prevent churn). If every slot is `claimed`/`running` (or none is old enough), return a **busy** state. An evicted visitor's click gets a cold start, or busy if every slot is running.
- **D-10:** A page reload reuses the visitor's existing container rather than warming another.

### Pi run and results
- **D-11:** Each job execs `pi --mode json "<task>"` inside the warm container: one Pi process per job, JSONL events on stdout, completion by process exit plus exit code (`agent_settled` is also available in the stream). — **Reversibility:** reversible — **rationale:** isolated inside the runtime module. **Rejected:** RPC mode with a warm Pi (only saves Node boot; Pi scans skills at startup per `docs/skills.md`, so a Pi started before the skill is mounted would never see it; stdin exec hijack over Podman's compat API is the riskiest part; a warm RPC process is orphaned when the app restarts) and print mode (no tool events).
- **D-12:** The progress feed shows real Pi events mapped to `JobEvent`s: tool calls become `tool_start`/`tool_end` lines, plus `info` lines for container/Pi startup and the fallback notice. This supersedes Phase 7's D-11, which avoided tool events only because no real tool stream existed.
- **D-13:** The artifact is a zip of the job's `output/` directory (per `docs/job-api-contract.md`), replacing Phase 7's single `.txt`. Valid only when `status === 'succeeded'`.
- **D-14:** The Phase 7 OpenAI runner stays as a fallback **only** when the container engine is unreachable or a container fails to start. **Never** when the cap is hit: cap-hit returns busy (supersedes the earlier "fall back at cap" idea). Every fallback is logged as a warning and the progress feed says so. The fallback emits the same `JobEvent`s and the same zip artifact format (`result.txt` inside). The fallback is configurable on/off via an env var.
- **D-15:** Tests use a fake runtime behind the container-manager module interface, never the OpenAI runner, so the suite runs without Podman or an API key.
- **D-16:** Success and failure follow `docs/job-api-contract.md` completion semantics: a clean exit means `succeeded`; non-zero exit, timeout, or error means `failed` with a real error string. Do not key success off `agent_end`.

### Keys, network, limits
- **D-17:** The real LLM key never enters the container. The app exposes an **LLM proxy route**. Each container gets a random per-lease token and a base URL pointing at the proxy, as env vars. The proxy validates the token, enforces a per-job token/cost budget, injects the real `OPENAI_API_KEY` server-side (still server-only, as in Phase 7 D-09), and streams responses through. The token is revoked when the lease ends. — **Reversibility:** costly — **rationale:** the container env, Pi provider config, network layout and budget enforcement all depend on the proxy being the only LLM path.
- **D-18:** Pi must be pointed at the proxy through a custom provider base URL (`models.json`). Verify Pi supports this (research item R-02).
- **D-19:** Containers sit on a Podman `--internal` network; the app's LLM proxy is the only reachable endpoint. If the app runs under the same Podman user, attach the app to that internal network as a second network. If the runner is a dedicated user, add a minimal relay container (socat or nginx) bridging to the app's published proxy port only. The proxy later becomes the only allowed egress target. Open egress is allowed only in local dev, never in a public deployment.
- **D-20:** Verify that name resolution works on the internal network and that Pi starts cleanly with no internet. Disable any update check or telemetry at startup.
- **D-21:** Per-container limits default to the GAISE values, all env-overridable: 1 GB memory, 0.5 CPU, 200 pids, all capabilities dropped, non-root, no published ports, tmpfs work dir (256 MB) and `/tmp` (64 MB); read-only root filesystem if Pi allows it.
- **D-22:** Per-job limits: a hard wall-clock timeout (e.g. 5 min, env-configurable) that kills the Pi process, plus the proxy's per-job token/cost budget. Exceeding either gives `failed` with a real error string.

### Claude's Discretion
- Exact cap value, idle TTL, timeout and budget defaults (within the stated ranges), and env var names.
- How a "session" is identified for D-06 (existing auth session via `locals.user` when `AUTH_ENABLED`, a cookie when auth is off in dev).
- How the warm-up is triggered from the page (load function side effect vs. a small endpoint called from the client) and how the Try it out panel learns the container is ready.
- Module layout under `src/lib/server/` for the container manager, runtime interface, event mapper and proxy.
- Container naming/labelling and orphan cleanup on app restart.
- How to adapt `data/tryitout-prompts/<slug>/skill.md` to Pi's skill format (see R-05).
- Whether the proxy and relay details differ between dev and deployment.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Job contract and current runtime
- `docs/job-api-contract.md` — frozen client API, `JobStatus`/`JobEvent`/`JobUpdate` types, completion semantics, zip artifact; real-backend swap point.
- `src/lib/tryItOut.ts` — the three frozen functions; UI imports only these.
- `src/lib/server/tryItOutRunner.ts` — Phase 7 runner; `runJob` is the swap point and becomes the fallback.
- `src/lib/server/tryItOutJobs.ts` — in-memory job store, working directories, `pushEvent`/`setStatus`.
- `src/lib/server/tryItOutPrompts.ts`, `src/lib/server/tryItOutModel.ts` — prompt loading and fixed model used by the fallback.
- `src/routes/api/tryitout/jobs/` — the three job routes (POST create, GET status, GET artifact).
- `data/tryitout-prompts/demo-rfi-triage/` — current `skill.md` and sample input for the one runnable agent.
- `src/routes/agents/[slug]/+page.svelte`, `+page.server.ts` — where the warm trigger attaches; gates the panel on `tryItOutMode === 'runnable'`.

### Deployment
- `Containerfile`, `podman-compose.yml` — current app container, volumes, env; the socket mount and internal network are added here.
- `README.md` (Podman deployment and Try it out sections).

### Prior phase context (locked decisions)
- `.planning/phases/07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou/07-CONTEXT.md` — D-06..D-09 (OpenAI, server-only key, fixed model), D-11/D-12 (staged events; D-12 here supersedes the "no tool events" part), deferred item that this phase now covers.
- `.planning/phases/06-runnable-try-it-out-flow-mock-backed/06-CONTEXT.md` — frozen client API, `agent_settled` completion semantics.
- `.planning/phases/05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape/05-CONTEXT.md` — `try_it_out_*` columns set outside ingest.

### External references
- `https://github.com/GPT-Laboratory/GAISE26_tool_building_pi_agents` — `backend/src/pool.ts` (dockerode pool, limits), `docker/Dockerfile`, `docker/entrypoint.sh`, `scripts/hardening.sh` (egress allowlist). Idea source only.
- Pi docs (npm `@earendil-works/pi-coding-agent`, 1.0.4): `docs/cli.md`, `docs/json.md`, `docs/skills.md`, `docs/containerization.md`, `docs/security.md`, `docs/models.md`, `docs/environment-variables.md`, `docs/cli-integration.md`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tryItOutJobs.ts`: job store, per-job work dirs, `pushEvent`/`setStatus` — the runtime module feeds events into it unchanged.
- `tryItOutRunner.ts` + `tryItOutPrompts.ts` + `tryItOutModel.ts`: becomes the fallback path with a zip artifact added.
- `TryItOutPanel.svelte` and the three job routes: unchanged, except the artifact route returns a zip.
- `hooks.server.ts` auth: provides the session identity to key one-container-per-session on.

### Established Patterns
- Server-only code under `src/lib/server/`; private env via `$env/dynamic/private`.
- Env-configurable paths and limits (`TRYITOUT_WORK_DIR`, `TRYITOUT_PROMPTS_DIR`); new knobs follow the same style.
- Jobs are in memory and lost on restart; container leases will be too (orphan cleanup needed).
- One runnable agent today (`demo-rfi-triage`), set via `scripts/set-try-it-out-mode.ts`.

### Integration Points
- Container manager module (new) called from the agent page load/endpoint (warm) and from `runJob` (claim and run).
- LLM proxy route (new) under `src/routes/api/` with token validation separate from user auth (containers carry no user cookie).
- `Containerfile`/`podman-compose.yml`: socket mount, internal network, image build for `pi-runner`.

</code_context>

<specifics>
## Specific Ideas

- Jussi: "when someone browses to the page, we start warming a container that has Pi and the skill."
- Research items to verify before planning (not decisions):
  - **R-01:** Podman's Docker-compatible API supports what `dockerode` needs (create/start/exec/stream/stop/remove, networks) in rootless and in the app-container-with-socket setup.
  - **R-02:** Pi supports a custom provider base URL (`models.json`), and the container can reach the app's proxy (`host.containers.internal`, a published port, or the internal network).
  - **R-03:** Pi starts cleanly with no internet; how to disable its update check and telemetry.
  - **R-04:** The `--mode json` event schema (`docs/json.md`) and how its tool events map to `JobEvent`.
  - **R-05:** Pi's `SKILL.md` format (frontmatter with name and description; skills without a description are not loaded) versus our `skill.md`.
  - **R-06:** Whether a read-only root filesystem works with Pi, and what `docs/containerization.md` and `docs/security.md` recommend.
  - **R-07:** Same-user vs. dedicated-user runner decides between the second-network attach and the relay container (D-19).

</specifics>

<deferred>
## Deferred Ideas

- Per-agent container images and a `runtime:` block in the agent YAML (image, timeout, secrets) — later, once more agents are runnable.
- Structured `inputSchema` fields passed through the job API.
- Human-approval step for `requiresHumanApproval` agents.
- Persisting jobs in SQLite and tying them to users.
- Running third-party or other creators' agents (e.g. AIRO is a ChatGPT-hosted Custom GPT and stays external-link only).
- A shared warm pool per agent (rejected for now in favor of per-session containers).

</deferred>

---

*Phase: 08-container-backed-try-it-out-warm-on-visit*
*Context gathered: 2026-10-06*
