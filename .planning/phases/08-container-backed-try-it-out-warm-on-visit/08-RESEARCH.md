# Phase 8: Container-backed Try It Out (warm on visit) - Research

**Researched:** 2026-10-08
**Domain:** Podman Docker-compat API via dockerode, Pi coding agent (`pi --mode json`) in containers, app-hosted LLM proxy, SvelteKit server wiring
**Confidence:** MEDIUM (Pi docs/source verified from the real 1.0.4 tarball; Podman behaviour verified from docs/source only, because Podman is NOT installed here. Several items need a live smoke test, listed in Open Questions and Wave 0.)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** The app (itself a Podman container in deployment: `Containerfile`, `podman-compose.yml`) starts Pi containers by mounting the host's Podman socket into the app container and calling its Docker-compatible API. (costly to reverse)
- **D-02:** One generic `pi-runner` image with Pi installed. The agent's skill is mounted/copied in at start (from `data/tryitout-prompts/<slug>/`). Adding a runnable agent means adding a skill folder, not building an image.
- **D-03:** Local dev (`npm run dev`, no app container) uses the same code path against the developer's own rootless Podman socket (`$XDG_RUNTIME_DIR/podman/podman.sock`). One code path; developers need Podman running locally.
- **D-04:** The server talks to the engine with `dockerode` over the socket, not by shelling out to the `podman` CLI.
- **D-05:** Trigger = opening the agent detail page (`/agents/<slug>`) of a runnable agent. Warm-up runs in the background and must not block page render.
- **D-06:** One container per visitor session. Maximum **one** warm container per session: a new page (another agent) in the same session replaces it.
- **D-07:** A container is reused for several jobs, one after another, with a fresh work dir per job. Idle TTL ~5 minutes, configurable.
- **D-08:** Lease state machine: `warming -> idle -> claimed -> running` (back to `idle` after a job, then `expired`/removed). Eviction only from `idle`, via atomic compare-and-set, so a concurrent claim can never race an eviction.
- **D-09:** Global cap on containers (~5 for the prototype, configurable). At the cap, evict the oldest-idle container first, only one idle for at least ~60 s. If every slot is `claimed`/`running` (or none old enough), return a **busy** state. An evicted visitor's click gets a cold start, or busy if every slot is running.
- **D-10:** A page reload reuses the visitor's existing container rather than warming another.
- **D-11:** Each job execs `pi --mode json "<task>"` inside the warm container: one Pi process per job, JSONL on stdout, completion by process exit plus exit code (`agent_settled` also available). Rejected: RPC mode with warm Pi, print mode.
- **D-12:** Progress feed shows real Pi events mapped to `JobEvent`s: tool calls become `tool_start`/`tool_end`, plus `info` lines for container/Pi startup and the fallback notice.
- **D-13:** Artifact is a zip of the job's `output/` directory, replacing Phase 7's single `.txt`. Valid only when `status === 'succeeded'`.
- **D-14:** Phase 7 OpenAI runner stays as fallback **only** when the container engine is unreachable or a container fails to start. **Never** when the cap is hit (cap-hit returns busy). Every fallback logged as a warning and the progress feed says so. Fallback emits the same `JobEvent`s and the same zip artifact format (`result.txt` inside). Configurable on/off via env var.
- **D-15:** Tests use a fake runtime behind the container-manager module interface, never the OpenAI runner; suite runs without Podman or API key.
- **D-16:** Success/failure follow `docs/job-api-contract.md`: clean exit = `succeeded`; non-zero exit, timeout, or error = `failed` with a real error string. Do not key success off `agent_end`.
- **D-17:** Real LLM key never enters the container. App exposes an **LLM proxy route**. Each container gets a random per-lease token and a base URL pointing at the proxy, as env vars. Proxy validates token, enforces per-job token/cost budget, injects the real `OPENAI_API_KEY` server-side, streams responses through. Token revoked when the lease ends. (costly to reverse)
- **D-18:** Pi must be pointed at the proxy through a custom provider base URL (`models.json`). Verify Pi supports this (R-02).
- **D-19:** Containers sit on a Podman `--internal` network; the app's LLM proxy is the only reachable endpoint. If the app runs under the same Podman user, attach the app to that internal network as a second network. If the runner is a dedicated user, add a minimal relay container (socat or nginx) bridging to the app's published proxy port only. Open egress only in local dev, never in a public deployment.
- **D-20:** Verify name resolution works on the internal network and that Pi starts cleanly with no internet. Disable any update check or telemetry at startup.
- **D-21:** Per-container limits default to GAISE values, env-overridable: 1 GB memory, 0.5 CPU, 200 pids, all capabilities dropped, non-root, no published ports, tmpfs work dir (256 MB) and `/tmp` (64 MB); read-only root filesystem if Pi allows it.
- **D-22:** Per-job limits: hard wall-clock timeout (e.g. 5 min, env-configurable) that kills the Pi process, plus the proxy's per-job token/cost budget. Exceeding either gives `failed` with a real error string.

### Claude's Discretion
- Exact cap value, idle TTL, timeout and budget defaults (within stated ranges), and env var names.
- How a "session" is identified for D-06 (existing auth session via `locals.user` when `AUTH_ENABLED`, a cookie when auth is off in dev).
- How the warm-up is triggered from the page (load function side effect vs. a small endpoint called from the client) and how the Try it out panel learns the container is ready.
- Module layout under `src/lib/server/` for the container manager, runtime interface, event mapper and proxy.
- Container naming/labelling and orphan cleanup on app restart.
- How to adapt `data/tryitout-prompts/<slug>/skill.md` to Pi's skill format (R-05).
- Whether the proxy and relay details differ between dev and deployment.

### Deferred Ideas (OUT OF SCOPE)
- Per-agent container images and a `runtime:` block in the agent YAML.
- Structured `inputSchema` fields passed through the job API.
- Human-approval step for `requiresHumanApproval` agents.
- Persisting jobs in SQLite and tying them to users.
- Running third-party or other creators' agents (AIRO stays external-link only).
- A shared warm pool per agent (rejected for now in favor of per-session containers).
</user_constraints>

<phase_requirements>
## Phase Requirements

No REQ-IDs are mapped (REQUIREMENTS TBD). Derived from decisions; the planner should map plans to D-xx.

| ID | Description | Research Support |
|----|-------------|-----------------|
| D-01..D-04 | Socket-mounted Podman + dockerode, one generic image | R-01 findings, Standard Stack, compose/Containerfile notes, Pitfalls 1-3 |
| D-05..D-10 | Warm on visit, per-session lease, CAS state machine, cap/busy | Architecture Pattern 1 (lease manager), session identity, orphan cleanup |
| D-11, D-12, D-16 | `pi --mode json` exec, event mapping, completion | R-04 event schema + mapping table + completion rule |
| D-13, D-14 | zip artifact, fallback | getArchive + tar-stream + fflate pattern; shared `zipOutputFiles` |
| D-17..D-20 | LLM proxy, internal network, offline Pi | R-02, R-03, R-07, proxy pattern |
| D-21, D-22 | limits, timeout, budget | R-06, container create options, timeout pattern |
</phase_requirements>

## Summary

The design is feasible with all pieces confirmed from primary sources except live Podman behaviour (no `podman` or `docker` binary on this machine: `podman --version` returns "command not found", no socket at `/run/user/1000/podman`). Pi 1.0.4 (published 2026-10-05; **1.1.0 is already on npm as of 2026-10-07**, so pin the version in the image) supports a custom OpenAI-compatible provider via `models.json` (`baseUrl`, `api: "openai-completions"`, `apiKey` with `$ENV` interpolation), has `--offline` / `PI_OFFLINE` / `PI_SKIP_VERSION_CHECK` / `PI_TELEMETRY=0`, a `--no-session` flag, an agent-dir override (`PI_CODING_AGENT_DIR`), explicit `--skill`, `--append-system-prompt`, and the `/skill:<name> <args>` command expands in non-interactive prompts (verified in `dist/core/agent-session.js`). In JSON mode a failed assistant response does NOT produce a non-zero exit (docs/cli-integration.md), so the success rule must be: exit code 0 AND `agent_settled` seen AND last assistant message `stopReason` not `error`/`aborted`.

Two design traps found that the CONTEXT decisions do not anticipate: (1) with the Podman socket mounted into the app container, **bind-mount sources are host paths, not app-container paths**, and a rootless host user maps to uid 0 inside the app container while the Containerfile runs as `USER node` (socket permission denied). Therefore move files in and out with the Docker archive API (`putArchive`/`getArchive`), never bind mounts, and fix the socket access in compose. (2) Docker documents that `docker cp` cannot write into tmpfs mounts and a `ReadonlyRootfs` container rejects archive writes to the rootfs; whether Podman behaves the same is **unverified**, so a Wave 0 spike must decide between "tmpfs + putArchive" and the fallback ladder in Pattern 3.

**Primary recommendation:** One `ContainerRuntime` interface (create/start/exec/putFiles/getFiles/remove/list) with a dockerode implementation and an in-memory fake; a `LeaseManager` (synchronous state transitions = atomic CAS in single-threaded Node); an LLM proxy at `/api/llm/v1/chat/completions` speaking Chat Completions (Pi `api: "openai-completions"`); Pi invoked as `pi --mode json --no-session --offline ... "/skill:<slug> <short fixed instruction>"` with the task and uploaded file written into the container as files (never in argv); output retrieved with `getArchive`, converted to zip with `tar-stream` + `fflate`, and stored on the app side under the job dir.

## Standard Stack

### Core
| Library | Version (verified `npm view`, 2026-10-08) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| dockerode | 5.0.1 | Engine API over the Podman socket (D-04) | Locked by D-04; pulls `docker-modem` 5.x, `tar-fs` 2.x, grpc/protobuf (build-kit only, heavy but unused) |
| @types/dockerode | 4.0.1 | Types | dev dependency |
| tar-stream | 3.2.2 (repo currently has 2.2.0 only as a transitive dep of better-sqlite3/prebuild-install/tar-fs) | Parse `getArchive` tar, build `putArchive` tar | Add as a DIRECT dependency; do not rely on the transitive one |
| fflate | 0.8.3 (zero deps, pure JS) | Build the zip artifact (`zipSync`/`Zip`) | Smallest zero-dep option, works in Node and tests; artifacts are small |
| openai | 7.5.0 (already in repo) | Fallback runner only (Phase 7) | Unchanged |
| @earendil-works/pi-coding-agent | pin 1.0.4 (latest on npm 1.1.0, modified 2026-10-07) | Agent inside the `pi-runner` image | Required by phase. Pin so docs researched here match behaviour; Pi needs Node >= 22.19 (engines) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.1.0 (in repo) | Tests with fake runtime | All non-Podman tests |
| zod | in repo | Validate env/config and proxy request shape | Config parsing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| fflate | archiver 8.0.0 / yazl 3.3.1 | Both heavier streaming APIs; unnecessary for small outputs |
| getArchive+tar-stream | `exec zip -r - .` and read binary stdout | Needs `zip` in image and binary demux over exec; riskier than archive endpoint |
| Chat Completions proxy | Responses API proxy | Pi supports `openai-responses` too, but Chat Completions is the documented `models.json` example (Ollama/LM Studio/proxy), and simpler to stream through. See R-02 |

**Installation:**
```bash
npm install dockerode tar-stream fflate
npm install -D @types/dockerode
# image (Containerfile.pi-runner):  npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.0.4
```

**Version verification:** `npm view dockerode version` -> 5.0.1; `npm view fflate version` -> 0.8.3; `npm view tar-stream version` -> 3.2.2; `npm view @types/dockerode version` -> 4.0.1; `npm view @earendil-works/pi-coding-agent version` -> 1.1.0 (task pinned 1.0.4; tarball for 1.0.4 was packed and its docs read).

## Research Findings R-01 .. R-07

### R-01 Podman Docker-compat API vs dockerode (MEDIUM; live test required)
- Environment: `podman` and `docker` are NOT installed locally; socket path `/run/user/1000/podman/podman.sock` absent. Nothing below was run against a live engine.
- Compat routes confirmed in Podman source (`pkg/api/server/register_exec.go`, `register_archive.go`, raw.githubusercontent.com, main branch): `POST /containers/{name}/exec`, `POST /exec/{id}/start`, `POST /exec/{id}/resize`, `GET /exec/{id}/json`; `GET|PUT|HEAD /containers/{name}/archive` (compat) so `getArchive`/`putArchive` exist. Container create/start/stop/remove, `networks` (incl. `Internal: true`) and `networkConnect` are standard compat endpoints; docs confirm "container management, image handling, volumes, networks, and command execution work" (oneuptime.com 2026-03-18 article, secondary source).
- Exec with `Tty:false`, `Detach:false` returns the same multiplexed raw stream format as attach (demux with `docker.modem.demuxStream`). Podman's compat exec-start handler hijacks the connection when `Detach` is false and passes **stdin as nil** (`handlers/compat/exec.go`: `ExecHTTPStartAndAttach(sessionID, r, w, nil, nil, nil, hijackChan, size)`), so **stdin over exec is the risky path; do not use it** (this independently confirms D-11's rejection of RPC mode). Source also has TODOs about Tty validation between create and start: always set the same `Tty:false` on both.
- Risky dockerode calls: exec stream demux (binary/partial frames: always use `modem.demuxStream` rather than splitting raw bytes), `exec.inspect` immediately after stream end (ExitCode can still be `null`/`Running:true`; poll up to ~2 s), `putArchive` into tmpfs/readonly rootfs (see Pattern 3), attach hijack (avoid; use exec only).
- No client-side exec kill exists in the Docker API: kill by wrapping the command in `timeout --signal=KILL <s>` (coreutils, present in node:22-bookworm-slim) AND on the app-side timer remove/force-kill the container.
- GAISE `backend/src/pool.ts` (fetched): uses dockerode with `Memory 1GB, NanoCpus 0.5e9, PidsLimit 200, CapDrop ALL, Tmpfs {/home/agent/work 256M, /tmp 64M}, NetworkMode`, env `OPENAI_BASE_URL/OPENAI_API_KEY/PI_MODEL`; targets Docker, has NO exec usage and no Podman workarounds. It is not evidence that Podman works.
- Rootless caveats (docs knowledge, MEDIUM): memory/pids/cpu limits in rootless Podman require cgroup v2 controller delegation; if `cpu` is not delegated Podman may warn or error. Smoke-test `NanoCpus` specifically.
- App-in-container socket access: the rootless host user is uid 0 inside the app container, but the Containerfile runs `USER node` (uid 1000 in container = a subuid on the host) so it cannot open the 0700-owned socket. Options (pick by smoke test): compose `userns_mode: keep-id:uid=1000,gid=1000` (host user 1000 == container `node`), or `user: "0"` for the app container (weaker). SELinux hosts need `security_opt: [label=disable]` on the app container for the socket mount (or `:z`).

### R-02 Pi custom provider and proxy API shape (HIGH for Pi config; MEDIUM for network reachability)
- Source: `docs/models.md` "Configure a compatible endpoint" in the 1.0.4 tarball. File location `<agent-dir>/models.json` (agent-dir default `~/.pi/agent`, override `PI_CODING_AGENT_DIR`).
```json
{
  "providers": {
    "aic": {
      "baseUrl": "http://aic-agent-library:3000/api/llm/v1",
      "api": "openai-completions",
      "apiKey": "$AIC_LLM_TOKEN",
      "models": [ { "id": "gpt-4.1-mini" } ]
    }
  }
}
```
- `apiKey` and header values support `$NAME`/`${NAME}` env interpolation (so the per-lease token is an env var, not baked in). `baseUrl` interpolation is NOT documented: render `models.json` at warm time with the concrete URL (write it into the container, Pattern 3).
- Select with `--provider aic --model gpt-4.1-mini` (docs/cli.md). `models.json` entries are minimal (`{ "id": ... }`); optional metadata (contextWindow, maxTokens, cost) can be added.
- API types available: `openai-completions`, `openai-responses`, `azure-openai-responses` (docs/models.md sampling note) plus Anthropic/Google. **Recommended proxy shape: `POST {baseUrl}/chat/completions`, SSE streaming, `Authorization: Bearer <token>`** (Pi sends the apiKey as bearer). Proxy must also tolerate `stream_options.include_usage`, tool calls (`tools`, `tool_calls` deltas) and pass SSE through unchanged. The Phase 7 fallback uses the Responses API; the proxy does not need to.
- Compat flags (`supportsDeveloperRole`, `supportsUsageInStreaming`, `supportsStore`, `supportsMaxOutputTokens`, `supportsStrictTools` ... all exist in `dist/core/model-config.d.ts`): docs warn to enable them only for verified differences. Since the proxy forwards to real OpenAI, defaults should work; verify first request live. Proxy should defensively normalize: force `model` to the fixed `MODEL`, set `stream_options.include_usage=true`, clamp `max_tokens`/`max_completion_tokens`, drop `store`.
- Reachability: see R-07. Recommended: app container attached to the internal network under a stable network alias; Pi `baseUrl` uses that name. Dev (`npm run dev` on host): a rootless container cannot reach a host service bound to 127.0.0.1 via `host.containers.internal` (resolves to a non-loopback gateway address; needs pasta `--map-gw`/`--map-host-loopback`, or the dev server bound to `0.0.0.0` via `vite dev --host`). Verify live.
- Token ends up in the container env and the model's tools can read it: acceptable only because it is per-lease, revoked at lease end, and budget-capped (D-17/D-22).

### R-03 Pi offline start, update check, telemetry (MEDIUM: source-verified, not run)
- Pi was NOT executed (downloaded package treated as untrusted); verified from docs and `dist/` source.
- `PI_OFFLINE=1` (or `--offline`): "Disable automatic network activity, including model catalog refreshes" (docs/environment-variables.md); `dist/main.js:452-455` sets `PI_OFFLINE=1` AND `PI_SKIP_VERSION_CHECK=1` when offline; changelog: "startup network timeouts to avoid hangs in restricted or offline environments". `dist/utils/tools-manager.js` downloads `fd`/`ripgrep` from GitHub when missing and honors `PI_OFFLINE`, so ALSO `apt-get install ripgrep fd-find` in the image (docs/containerization.md installs `ripgrep`).
- `PI_SKIP_VERSION_CHECK=1` disables the pi.dev latest-version request; `PI_TELEMETRY=0` disables install/update telemetry and provider attribution headers; setting `enableInstallTelemetry:false` is also available (it only affects install/update reporting, not update checks). Set all three env vars in the container.
- LLM calls themselves are NOT blocked by `PI_OFFLINE`; they go to the proxy URL.
- Smoke test expectation: `pi --mode json --offline --no-session ...` on the `--internal` network starts, reaches the proxy, and emits `agent_settled`; no DNS failures on stderr.

### R-04 `pi --mode json` event schema and mapping (HIGH: docs/json.md read in full)
- Framing: strict JSONL, LF-terminated; split ONLY on `\n` (strip optional `\r`), NOT with Node `readline` (Unicode separators); stdout is reserved for JSONL, diagnostics on stderr; keep reading stdout or Pi can stall on a full pipe.
- First record: `{"type":"session","version":3,"id":...,"timestamp":...,"cwd":...}` (JSON mode only).
- Sequence: `agent_start`, `turn_start`, `message_start`/`message_update`/`message_end`, `tool_execution_start|update|end`, `turn_end`, `agent_end` (has `willRetry`), `agent_settled`. Also `auto_retry_start/end` (`finalError` on failure), `compaction_*`.
- `tool_execution_start {toolCallId, toolName, args}`; `tool_execution_end {toolCallId, toolName, result, isError}`.
- Built-in tool arg names (from `dist/core/tools/*.js`): `read {path, offset?, limit?}`, `write {path, content}`, `edit {path, oldText, newText}` (edits array form possible), `bash {command, timeout?}`, `grep {pattern, path?, glob?}`, `find {pattern, path?}`, `ls {path?}`.
- Mapping to `JobEvent {ts, type, tool?, summary}`:

| Pi event | JobEvent | summary |
|----------|----------|---------|
| `session` | `info` | `pi session started` (optional) |
| `tool_execution_start` | `tool_start`, `tool=toolName` | `read input/task.txt`, `write output/result.txt`, `grep <pattern> in <path>`, `bash <command, truncated to ~80 chars>` |
| `tool_execution_end` isError=false | `tool_end` | `<same summary> done` (optionally line count from result) |
| `tool_execution_end` isError=true | `tool_end` | `<tool> failed: <first line of result text>` |
| `auto_retry_start` | `info` | `retrying model call (attempt n/m): <errorMessage>` |
| `agent_settled` | `info` | `agent settled` |
| anything else | dropped | (do NOT emit per `message_update` delta) |

  Correlate start/end by `toolCallId` (keep a Map to reuse the start summary). Truncate summaries (path/command may contain untrusted/long text); never include `args.content`.
- Completion/failure rule (D-16): `succeeded` iff exec ExitCode === 0 AND `agent_settled` observed AND the last assistant `message_end.message.stopReason` is not `error`/`aborted` AND no `auto_retry_end{success:false}`. Otherwise `failed`, error string preference order: last assistant `message.errorMessage`, `auto_retry_end.finalError`, `timeout after Ns`, last ~500 chars of stderr, `pi exited with code N`. docs/cli-integration.md states a failed/aborted response "does not by itself produce a nonzero exit status", hence the extra checks. Never key off `agent_end`.
- Files written: do not parse `write` events for artifacts; after exit read `/work/<jobId>/output/` via `getArchive` (authoritative).

### R-05 Skill format vs `skill.md` (HIGH: docs/skills.md + source)
- Pi implements the Agent Skills spec: a directory containing `SKILL.md` with YAML frontmatter `name` (lowercase letters/digits/hyphens, <=64 chars, matches our slug regex) and `description` (<=1024). "Malformed SKILL.md files and declared skills without descriptions are not loaded." Our `data/tryitout-prompts/demo-rfi-triage/skill.md` has NO frontmatter and a preamble that talks about "one model call"; it will not load as-is.
- Discovery: `<agent-dir>/skills/`, `~/.agents/skills/`, project `.pi/skills` and `.agents/skills` (project ones are trust-gated); explicit `--skill <path>` (file or dir, repeatable); `-ns/--no-skills` disables discovery but explicit `--skill` still loads. Skills are scanned at Pi startup (new exec = new startup, fine).
- Model might not load a skill on its own. Deterministic invocation: first prompt starting with `/skill:<name> <args>`; verified in `dist/core/agent-session.js:1661-1680` that `_expandSkillCommand` inlines `<skill name=... location=...>` + body + args, and it is applied in `prompt()` (not interactive-only). **Gotcha:** it only expands if the message `startsWith("/skill:")`, so do NOT combine with `@file` args (they get prepended to the first prompt) and do not prefix text.
- Required adaptation (recommended): rename to `data/tryitout-prompts/<slug>/SKILL.md`, add frontmatter (`name: <slug>`, `description: ...`), drop the "single model call / no other inputs" preamble and adjust the body to the file-based workflow ("read `input/task.txt` and, if present, `input/upload.txt`; write the result to `output/result.txt`"). Update `loadPromptFor` (fallback) to read `SKILL.md` and strip frontmatter, and update `tryItOutPrompts.test.ts`. Keep the file generic enough that the fallback prompt composition still works.
- Base system prompt: `agents.system_prompt` -> write to a file and pass `--append-system-prompt /home/pi/agent/base-prompt.md` (docs/cli.md: text or existing file, repeatable). Prefer append over `--system-prompt` (replace) so Pi keeps its tool descriptions and skill list. Alternative equivalent: `<agent-dir>/APPEND_SYSTEM.md`.
- Invocation (argv is short and constant; untrusted text lives only in files, avoids the 128 KB single-argument limit since uploads can be 200 KB and prompt-injection-in-argv):
```
timeout --signal=KILL 300 pi --mode json --no-session --offline --no-extensions --no-mcp \
  --no-prompt-templates --no-themes --no-context-files --no-approve -ns --skill /home/pi/agent/skills/<slug> \
  --provider aic --model gpt-4.1-mini --tools read,write,edit,grep,find,ls \
  --append-system-prompt /home/pi/agent/base-prompt.md \
  -- "/skill:<slug> Follow the skill. Inputs are in ./input (task.txt, optional upload.txt). Write all deliverables as files in ./output."
```
  (cwd = `/work/<jobId>`). Flags verified in docs/cli.md. Omitting `bash` from `--tools` removes shell access; make it env-configurable.

### R-06 Read-only rootfs, writable paths, Pi docs recommendations (MEDIUM)
- docs/containerization.md and docs/security.md recommend running the whole Pi process inside a container/VM, exposing only the working folder, credentials and network destinations needed; `--ignore-scripts` npm install; no mention of read-only root FS. Security.md: Pi has no built-in sandbox and "keep credentials outside the environment where possible, or use narrowly scoped, short-lived credentials" (matches D-17 proxy token).
- Pi writes only under the agent dir (settings lock via `proper-lockfile`, `auth.json` dir creation, model catalog cache), the session dir (skipped with `--no-session`), and `os.tmpdir()` (truncated tool output files `output-files.js`). Therefore a read-only root is plausible if these are writable: `PI_CODING_AGENT_DIR=/home/pi/agent` (tmpfs ~16 MB), `/work` (tmpfs 256 MB), `/tmp` (tmpfs 64 MB). Set `HOME=/home/pi`. Not executed: confirm in the smoke test that Pi starts with `ReadonlyRootfs:true`.
- Podman `--read-only` (default `--read-only-tmpfs=true`) mounts `/dev,/dev/shm,/run,/tmp,/var/tmp` as tmpfs; set `Tmpfs` explicitly in `HostConfig` anyway.
- Create options (dockerode): `User: 'pi'` (uid 1000 in image), `HostConfig: { Memory: 1<<30, NanoCpus: 5e8, PidsLimit: 200, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], ReadonlyRootfs: true, Tmpfs: { '/work': 'rw,size=256m,mode=1777,noexec?', '/tmp': 'rw,size=64m,mode=1777', '/home/pi/agent': 'rw,size=16m,uid=1000,gid=1000,mode=0700' }, NetworkMode: <internal net>, AutoRemove: false }`, `Labels`, `Env`, `Cmd: ['sleep','infinity']` (use `--init`/`Init:true` so exec'd children are reaped). Do not use `noexec` on `/work` if the model may run scripts; with bash removed it is safe.
- tmpfs `uid=`/`gid=` options and ownership of exec'd processes under rootless user namespaces need a live check (Pitfall 6).

### R-07 Same-user vs dedicated runner (MEDIUM)
- Podman docs (`podman network create --internal`): "No default route will be added to the container", IP forwarding disabled on the bridge, and "aardvark-dns will only resolve container names with this option enabled. Other queries will be answered with NXDOMAIN". So name resolution of the app by its container name/alias works on the internal network, and nothing external does (matches D-20); verify live that DNS actually answers (aardvark-dns is a netavark feature; the CNI backend lacks it).
- **Same Podman user (recommended for the prototype):** create network `aic-pi-internal` (`Internal:true`, `Labels`), attach the app container as a SECOND network with alias `aic-agent-library` (compose: networks block with explicit `name:`), Pi containers join only the internal network. The app does NOT need network access to Pi containers (all control is via the engine API: exec, archive), so only Pi -> app:3000 traffic exists. The app must listen on `0.0.0.0` (already `HOST=0.0.0.0`). Because ALL of app port 3000 is then reachable from Pi containers (not only the proxy), add a guard: the proxy route requires the lease token; other routes are normal user-authed (cookie) routes and Pi containers have no cookie. Add no new unauthenticated routes except `/api/llm/*`.
- **Dedicated user / host-run app (relay):** relay container (socat) on the internal network plus a default network, forwarding `relay:3000 -> host.containers.internal:<app port>`; costs one extra container and a published/mapped port. Defer; only document the env var `PI_LLM_PROXY_URL` that makes the base URL configurable.
- Manager config: `PI_RUNNER_NETWORK` (network name, default `aic-pi-internal`), `PI_LLM_PROXY_URL` (default `http://aic-agent-library:3000/api/llm/v1`). On startup `inspectNetwork`; if missing, create with `Internal: true` (idempotent, ignore 409). If the engine is unreachable -> fallback path (D-14).
- Dev: network unset/`podman` default (not internal) with proxy URL `http://host.containers.internal:5173/api/llm/v1` and the dev server on `--host`; open egress allowed in dev only per D-19. Needs live verification (R-02).

## Architecture Patterns

### Recommended Project Structure
```
src/lib/server/tryitout/            # (or flat files with tryItOut* prefix to match existing style)
├── runtime.ts            # ContainerRuntime interface + types (create/start/exec/putFiles/getFiles/remove/list/ensureNetwork)
├── runtimeDockerode.ts   # dockerode implementation (only file importing 'dockerode')
├── runtimeFake.ts        # in-memory fake used by tests (scriptable exec output, failures, latency)
├── leaseManager.ts       # state machine, per-session map, cap/evict/busy, TTL reaper, orphan cleanup
├── piEvents.ts           # JSONL parser (LF split) + Pi event -> JobEvent mapper + completion tracker (pure, unit-tested)
├── piRunner.ts           # runJobInContainer(job): claim lease, stage files, exec, stream events, collect output, release
├── llmProxy.ts           # token registry + budget accounting + upstream forwarding (pure logic, no SvelteKit)
├── artifact.ts           # zipOutputFiles(): tar stream -> zip; shared with the fallback runner
├── session.ts            # sessionKey(event): auth email or anon cookie
└── config.ts             # env parsing with defaults (zod)
src/routes/api/llm/v1/chat/completions/+server.ts   # thin route over llmProxy
Containerfile.pi-runner   # generic pi-runner image
```
`tryItOutRunner.ts#runJob(jobId)` becomes the dispatcher: try container path, on `EngineUnavailable|ContainerStartFailed` and `PI_FALLBACK_ENABLED` call the old body (renamed `runDirectLlmJob`) after `pushEvent('container unavailable, falling back to direct model call')` + `console.warn`; on `Busy` fail the job (`failed`, error "all Try It Out slots are busy, try again shortly") and NEVER fall back (D-14).

### Pattern 1: Lease manager with synchronous CAS (D-06..D-10)
**What:** `Map<sessionKey, Lease>` plus global list. Every transition is a synchronous function (no `await` between read and write), which in single-threaded Node IS an atomic compare-and-set. States: `warming -> idle -> claimed -> running -> idle`, plus `evicting`/`expired` terminal-ish.
**Rules:**
- `ensureWarm(sessionKey, slug)`: existing lease same slug and not expired -> return it (D-10); different slug -> mark old `evicting` (only if `idle`/`warming`; if `claimed/running` keep the old one until it finishes, new warm is skipped) and create new. Set the entry in the map BEFORE any `await` so concurrent page loads cannot double-create.
- `claim(sessionKey, slug)`: `idle -> claimed` synchronously; if `warming`, await its ready promise (bounded) then claim; if none, cold start (subject to cap); if `claimed|running`, throw `Busy` for that session.
- `evictOldestIdle()`: choose idle lease with `idleSince <= now - MIN_IDLE_MS` (60 s); CAS `idle -> evicting` synchronously, then `await runtime.remove`. If none, `Busy`.
- Reaper: `setInterval(...).unref()` every ~30 s, `idle` older than TTL (300 s) -> `evicting` -> remove. Guard against HMR duplicates with a `globalThis` flag.
- Revoke the LLM token in the same synchronous step that leaves `claimed/running` for good (eviction/removal) and when a job ends (new token per job is cleanest: reuse container, mint a fresh token + budget per job, update via env? env cannot change after create -> instead keep ONE token per lease whose budget is reset per job by `leaseManager`, see Open Question 3).
**Example (sketch):**
```typescript
function tryClaim(lease: Lease): boolean {        // synchronous => atomic
  if (lease.state !== 'idle') return false
  lease.state = 'claimed'
  return true
}
function tryEvict(lease: Lease, now = Date.now()): boolean {
  if (lease.state !== 'idle' || now - lease.idleSince < MIN_IDLE_MS) return false
  lease.state = 'evicting'
  return true
}
```

### Pattern 2: Run one job (D-11)
```typescript
// Source: dockerode README (exec + modem.demuxStream); Podman compat exec routes
const exec = await container.exec({
  Cmd: ['timeout', '--signal=KILL', String(timeoutSec), 'pi', ...args],
  AttachStdout: true, AttachStderr: true, Tty: false, WorkingDir: `/work/${jobId}`,
})
const stream = await exec.start({ Detach: false, Tty: false })
const out = new PassThrough(); const err = new PassThrough()
docker.modem.demuxStream(stream, out, err)
out.on('data', (chunk) => parser.push(chunk))   // LF-split, UTF-8 safe (use StringDecoder)
err.on('data', (c) => stderrTail.append(c))     // keep last ~4 KB
await once(stream, 'end')
let info = await exec.inspect()                 // poll while info.Running up to ~2 s
```
Use `StringDecoder('utf8')` for partial multibyte chunks; split on `\n` only; ignore unparseable lines (log at debug).

### Pattern 3: Getting files in and out (answer to "how does the app get output/")
- **Do NOT bind-mount** `TRYITOUT_WORK_DIR`: with the socket mounted into the app container, `Binds` sources are resolved on the HOST, not in the app container (`/app/runtime/tryitout-work` does not exist there). A shared named volume would expose every session's jobs to every Pi container. Use the archive API.
- In: `container.putArchive(tarBuffer, { path: '/work' })` with `tar-stream` `pack()` containing `<jobId>/input/task.txt`, optional `<jobId>/input/upload.txt`, empty `<jobId>/output/`. Warm time: write `models.json`, `base-prompt.md`, `skills/<slug>/SKILL.md` into `/home/pi/agent`. File ownership: set `uid/gid` (1000) and modes in tar headers.
- Out: `container.getArchive({ path: '/work/<jobId>/output' })` -> tar stream (entries are prefixed `output/`) -> `tar-stream` `extract()` -> collect regular files only (skip symlinks/devices, reject `..`/absolute names, cap total size e.g. 20 MB and 200 files) -> `fflate.zipSync` -> write `join(WORK_ROOT, jobId, 'artifact.zip')` on the app side. The artifact route then serves the stored zip, independent of container lifetime (lease may be evicted right after the job). Delete the container-side job dir (`exec rm -rf`) after fetching so tmpfs does not fill up across reuse (256 MB tmpfs shared over many jobs).
- **Unverified (Wave 0 spike #1):** Docker documents that `docker cp` cannot copy into tmpfs mounts, and that a read-only rootfs rejects archive writes. Podman's behaviour for compat `PUT /archive` into tmpfs/ReadonlyRootfs is not documented in anything fetched. Fallback ladder if the spike fails: (a) exec-based write: `exec sh -c 'cat > file'` is stdin (no); (b) generate files from env in the container's start command (`Cmd: ['sh','-c','mkdir -p ... && printf %s "$PI_MODELS_JSON" > .../models.json && exec sleep infinity']` for models.json/skill/base prompt; small), and for job inputs use the writable layer: drop `/work` tmpfs and `ReadonlyRootfs`, keep `/work` as a normal dir in the container layer with `StorageOpt size` unsupported rootless, so enforce size via a post-job `du` check; (c) as last resort run non-read-only. D-21 explicitly allows "read-only root if Pi allows it", so dropping read-only is within the decision.

### Pattern 4: LLM proxy route (D-17)
- `POST /api/llm/v1/chat/completions` (also respond 404 JSON to other `/api/llm/v1/*`, e.g. `GET /models` that some clients probe).
- Auth: `Authorization: Bearer <lease-token>` looked up in an in-memory `Map<tokenHash|token, {leaseId, jobBudget}>` with constant-time compare (`crypto.timingSafeEqual` over equal-length SHA-256 digests). Tokens: `crypto.randomBytes(32).toString('base64url')`. 401 if missing/unknown/revoked.
- **hooks.server.ts change is required:** with `AUTH_ENABLED` the hook returns 401 for any `/api/*` without a user cookie. Add a public prefix check for `/api/llm/` (token auth replaces user auth); `PUBLIC_ROUTES` is an exact-match Set so add `event.url.pathname.startsWith('/api/llm/')`. SvelteKit's CSRF origin check applies only to form-type content types, so a JSON POST from the container with no `Origin` is fine (MEDIUM; confirm in the proxy route test).
- Upstream: `fetch('https://api.openai.com/v1/chat/completions')` (base overridable by env for tests) with `Authorization: Bearer ${OPENAI_API_KEY}` read at request time from `$env/dynamic/private` (not at import time, as Phase 7). Build the upstream body from a whitelist (`messages`, `tools`, `tool_choice`, `stream`, `stream_options`, `temperature`, `parallel_tool_calls`, clamped `max_tokens`/`max_completion_tokens`), force `model: MODEL`, `store:false`, `stream_options.include_usage = true` when streaming. Return `new Response(upstream.body, {status, headers: content-type})` to stream SSE; `tee()` the stream to parse the last `usage` chunk (`prompt_tokens`, `completion_tokens`) and add to the job budget.
- Budget (D-22): per-job `maxTotalTokens` (e.g. 100k) and `maxRequests` (e.g. 40). Before forwarding, reject with 429 `{error:{message:'job token budget exceeded'}}` if already over; after each response add usage. Pi surfaces this as a model error -> Pi's `message.errorMessage` -> job `failed` with a real string (the runner should also read the proxy-recorded `budgetExceeded` flag to produce the clearest error).
- Also enforce: max request body size (e.g. 1 MB), abort upstream when the client disconnects (`request.signal`), never log Authorization headers or bodies.

### Pattern 5: Session identity (D-06)
- `AUTH_ENABLED` true: key = `locals.user.email` (set by `hooks.server.ts`). Auth off: cookie `aic_tryout_sid` (random 128-bit, `httpOnly`, `sameSite:'lax'`, `path:'/'`, set from the page `load` via `cookies.set`). Same helper is used by `+page.server.ts` (warm) and `POST /api/tryitout/jobs` (claim), so both resolve to the same lease. `runJob(jobId)` currently takes only the job id: extend `createJob`/`JobRecord` with `sessionKey` (not returned by the GET route, which already builds its response literally).

### Pattern 6: Warm trigger (D-05) and readiness
- In `src/routes/agents/[slug]/+page.server.ts`, after the DB row lookup and when `row.tryItOutMode === 'runnable'`: `void leaseManager.ensureWarm(sessionKey, row.slug).catch(log)` (do NOT await; load returns immediately). The server `load` re-runs on `invalidateAll`/navigation, which is safe because `ensureWarm` is idempotent (D-10). No client change is needed: the Try It Out panel and the three frozen client functions stay as is; readiness is surfaced to the user only through the first `info` events of the job (`using warm container` vs `starting container…`). If a visible indicator is wanted later, add a small GET status endpoint; not required.

### Pattern 7: Orphan cleanup and shutdown
- Label every container: `aic.tryitout=1`, `aic.instance=<random per app process>`, `aic.agent=<slug>`, `aic.created=<epoch>`; name `aic-pi-<random>`.
- On first use of the manager (lazy init, plus eager import from `hooks.server.ts` so it runs at server start): `listContainers({ all: true, filters: { label: ['aic.tryitout=1'] } })` -> `remove({ force: true })` all with a different `aic.instance`. Assumes a single app replica per engine (state is in memory); document it. Reaper also sweeps containers whose label timestamp is older than 2x TTL with no lease.
- `process.once('SIGTERM'|'SIGINT')`: best-effort `Promise.allSettled(remove)` of own containers (do not block exit beyond ~3 s). In dev HMR, guard singletons/interval with `globalThis.__aicTryItOut`.

### Compose/Containerfile changes (D-01, D-19)
- `Containerfile.pi-runner` (new): `FROM node:22-bookworm-slim`; `apt-get install -y --no-install-recommends bash ca-certificates ripgrep fd-find coreutils git`; `npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.0.4`; create user `pi` (uid 1000); `ENV PI_CODING_AGENT_DIR=/home/pi/agent HOME=/home/pi PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0`; `WORKDIR /work`; `USER pi`; `CMD ["sleep","infinity"]`. `fd-find` installs `fdfind`: tools-manager lists `fdfind` as a system binary name (verified in source).
- `podman-compose.yml`: app service gets `volumes: - ${XDG_RUNTIME_DIR}/podman/podman.sock:/run/podman/podman.sock`, `security_opt: [label=disable]`, `userns_mode` (see R-01), env `PI_RUNNER_SOCKET=/run/podman/podman.sock`, `PI_RUNNER_NETWORK=aic-pi-internal`, `PI_LLM_PROXY_URL=http://aic-agent-library:3000/api/llm/v1`, and `networks: [default, pi-internal]` with `pi-internal: { name: aic-pi-internal, internal: true }`. Image build step for `pi-runner` documented in README (`podman build -t pi-runner -f Containerfile.pi-runner .`).
- Keep `.env.example`/README updated: new env knobs below. Suggested names: `PI_RUNNER_ENABLED` (default true), `PI_RUNNER_IMAGE` (`pi-runner:latest`), `PI_RUNNER_SOCKET`, `PI_RUNNER_NETWORK`, `PI_LLM_PROXY_URL`, `PI_RUNNER_MAX_CONTAINERS` (5), `PI_RUNNER_IDLE_TTL_MS` (300000), `PI_RUNNER_MIN_IDLE_MS` (60000), `PI_RUNNER_JOB_TIMEOUT_MS` (300000), `PI_RUNNER_MEMORY_MB` (1024), `PI_RUNNER_CPUS` (0.5), `PI_RUNNER_PIDS` (200), `PI_RUNNER_WORK_TMPFS_MB` (256), `PI_RUNNER_TMP_TMPFS_MB` (64), `PI_RUNNER_TOOLS` (`read,write,edit,grep,find,ls`), `PI_FALLBACK_ENABLED` (true), `PI_JOB_TOKEN_BUDGET` (100000), `PI_JOB_REQUEST_BUDGET` (40).

### Anti-Patterns to Avoid
- Splitting exec output yourself instead of `demuxStream`; using `readline` on Pi's stdout.
- Passing user task text/file content in argv or in `Env` (E2BIG at 128 KB per argument; injection surface); write files instead.
- Bind-mounting app-container paths into Pi containers.
- Keying success off `agent_end`, exit code alone, or the existence of output.
- Awaiting warm-up in `load`, or doing `await` between checking and setting lease state (breaks CAS).
- Importing `dockerode` anywhere but the runtime implementation (tests must not need Podman).
- Reading `OPENAI_API_KEY` at module import (Phase 7 constraint SC-09).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Engine API client | raw HTTP over the unix socket | dockerode (D-04) | multiplexed streams, hijack, archive helpers |
| exec stdout/stderr split | custom frame parser | `docker.modem.demuxStream` | 8-byte frame header handling, partial frames |
| tar read/write | manual tar headers | `tar-stream` | long names, padding, PAX |
| zip creation | manual zip bytes | `fflate` `zipSync` | CRC, deflate, zip64 edge cases |
| random tokens/ids | Math.random | `crypto.randomBytes` / `randomUUID` | unguessable per-lease tokens |
| token compare | `===` | `crypto.timingSafeEqual` on digests | timing side channel |
| SSE pass-through | parse and re-emit chunks | stream the upstream `Response.body` through | exact bytes, backpressure, tool-call deltas |
| process kill on timeout | exec kill API (does not exist) | `timeout --signal=KILL` + remove container | engine has no exec kill |
| Pi event types | own copies of full schema | minimal local interface for the ~6 fields used | docs/json.md types are large; keep mapper tolerant of unknown events |

**Key insight:** every deceptively hard piece (stream framing, archives, zip, SSE) has a small dependable library or can be avoided entirely by design (files instead of argv, archive API instead of bind mounts).

## Common Pitfalls

### Pitfall 1: Socket permission denied inside the app container
**What goes wrong:** App starts as `node` (uid 1000) but the mounted rootless socket is owned by container-uid 0 (host user), connect gives EACCES -> every job silently falls back.
**Why:** rootless user namespace mapping. **Avoid:** compose `userns_mode: keep-id:uid=1000,gid=1000` (or run app as root), `label=disable` on SELinux hosts; log the engine-connect error once at startup. **Warning sign:** `EACCES /run/podman/podman.sock`.

### Pitfall 2: Host-path bind mounts
**What goes wrong:** `Binds: ['/app/runtime/...:/work']` mounts a nonexistent HOST path or exposes wrong data. **Avoid:** archive API only (Pattern 3).

### Pitfall 3: Archive into tmpfs/read-only rootfs
**What goes wrong:** `putArchive` to a tmpfs path or read-only rootfs fails or silently loses files (documented for Docker). **Avoid:** Wave 0 spike; fallback ladder; assert after `putArchive` by exec `test -f`.

### Pitfall 4: Failed model call still exits 0
**What goes wrong:** invalid key/budget exceeded gives an assistant message with `stopReason:"error"` but exit code 0. **Avoid:** completion rule in R-04.

### Pitfall 5: `hooks.server.ts` blocks the proxy
**What goes wrong:** with auth enabled the container's token request gets 401 "Authentication required" from the user-auth hook. **Avoid:** public prefix `/api/llm/`; test through the real `handle`.

### Pitfall 6: Rootless limits and tmpfs ownership
**What goes wrong:** `NanoCpus`/`PidsLimit` need cgroup v2 delegation; tmpfs mounts owned by root so `pi` user cannot write. **Avoid:** tmpfs options `uid=1000,gid=1000` (or `mode=1777`), smoke-test limits, make limits env-overridable and degrade (warn) if the engine rejects CPU.

### Pitfall 7: Cap/eviction races and leaks
**What goes wrong:** double creation on concurrent page loads; container leaked when job finishes after eviction; HMR duplicates intervals. **Avoid:** map entry set before first `await`; `evicting` state; globalThis guard; orphan sweep at start.

### Pitfall 8: tmpfs fills across job reuse
**What goes wrong:** 256 MB `/work` shared by sequential jobs. **Avoid:** delete `/work/<jobId>` after fetching output; cap output size; fail the job with a clear error on ENOSPC.

### Pitfall 9: `skill.md` without frontmatter is not loaded
**What goes wrong:** model just does nothing relevant. **Avoid:** `SKILL.md` + frontmatter + `/skill:<slug>` invocation; unit test that the converted skill has `name` and `description`.

### Pitfall 10: Frozen client names the download `.txt`
`downloadArtifact` in `src/lib/tryItOut.ts` hardcodes `aic-job-<id>.txt` and the artifact route sends `text/plain`; with the zip artifact change both to `.zip` / `application/zip` (body change only; signatures stay frozen) and update `tryItOut.test.ts` plus `jobs.test.ts` artifact expectations.

### Pitfall 11: Pi version drift
`npm install -g @earendil-works/pi-coding-agent` without a version now gives 1.1.0 (released 2026-10-07). Pin 1.0.4 in the Containerfile; re-verify flags if bumping.

## Code Examples

### JSONL line splitter (LF only, UTF-8 safe)
```typescript
// Source: docs/json.md "Framing" (Node readline is NOT suitable)
import { StringDecoder } from 'node:string_decoder'
export function createJsonlParser(onRecord: (r: unknown) => void) {
  const dec = new StringDecoder('utf8'); let buf = ''
  return {
    push(chunk: Buffer) {
      buf += dec.write(chunk)
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1)
        if (line) { try { onRecord(JSON.parse(line)) } catch { /* ignore garbage */ } }
      }
    },
    end() { buf += dec.end(); if (buf.trim()) { try { onRecord(JSON.parse(buf)) } catch {} } },
  }
}
```

### Completion tracker
```typescript
// Source: docs/json.md + docs/cli-integration.md (failed response does not change exit code)
let settled = false, lastStop: string | undefined, lastErr: string | undefined, retryFailed: string | undefined
function onEvent(e: any) {
  if (e.type === 'agent_settled') settled = true
  if (e.type === 'message_end' && e.message?.role === 'assistant') { lastStop = e.message.stopReason; lastErr = e.message.errorMessage }
  if (e.type === 'auto_retry_end' && e.success === false) retryFailed = e.finalError
}
const ok = exitCode === 0 && settled && lastStop !== 'error' && lastStop !== 'aborted' && !retryFailed
```

### Container create (dockerode)
```typescript
// Source: GAISE backend/src/pool.ts limits + Podman run docs (read-only, tmpfs, cap-drop, no-new-privileges)
const c = await docker.createContainer({
  Image: cfg.image, name: `aic-pi-${rand}`, User: 'pi', Cmd: ['sleep', 'infinity'],
  Labels: { 'aic.tryitout': '1', 'aic.instance': instanceId, 'aic.agent': slug },
  Env: [`AIC_LLM_TOKEN=${token}`],
  HostConfig: {
    Memory: cfg.memoryBytes, NanoCpus: cfg.cpus * 1e9, PidsLimit: cfg.pids, CapDrop: ['ALL'],
    SecurityOpt: ['no-new-privileges'], ReadonlyRootfs: true, Init: true,
    Tmpfs: { '/work': `rw,size=${cfg.workMb}m,mode=1777`, '/tmp': `rw,size=${cfg.tmpMb}m,mode=1777`,
             '/home/pi/agent': 'rw,size=16m,uid=1000,gid=1000,mode=0700' },
    NetworkMode: cfg.network,        // internal network; no PortBindings
  },
})
await c.start()
```

### Zip from getArchive
```typescript
// Source: dockerode getArchive (tar stream), tar-stream extract, fflate zipSync
const tarStream = await container.getArchive({ path: `/work/${jobId}/output` })
const files: Record<string, Uint8Array> = {}; let total = 0
for await (const entry of tarStream.pipe(tar.extract())) {   // entry: header + stream
  // regular files only; strip leading 'output/'; reject '..' and absolute; enforce caps
}
await writeFile(join(workDir(jobId), 'artifact.zip'), zipSync(files))
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 7: one Responses-API call in-process | Pi agent in warm container behind same job API | this phase | tool events, real file outputs, zip artifact |
| RPC/warm Pi process | one `pi --mode json` per job | D-11 | Node boot cost only; skills rescanned per run |
| Pi `agent_end` as completion | `agent_settled` + exit + stopReason checks | Pi docs (json.md) | avoids mid-retry false success |
| Pi azure provider name `azure-openai-responses` | renamed `azure` (1.0.3) | 2026-10-05 | irrelevant here (we use a custom provider), noted for flag drift |

**Deprecated/outdated:** Node `readline` for Pi JSON; Pi 1.0.4 (superseded by 1.1.0 on 2026-10-07, still fine to pin).

## Open Questions

1. **Does Podman compat `PUT /containers/{id}/archive` write into tmpfs mounts and a ReadonlyRootfs container?**
   - Known: route exists; Docker cannot. Unclear: Podman behaviour. Recommendation: Wave 0 spike (first task) with the exact create options; choose the fallback ladder from Pattern 3 based on the result.
2. **Does Pi 1.0.4 start and run fully under `ReadonlyRootfs`, `--offline`, internal network?** Not executed here (untrusted package). Recommendation: smoke script `scripts/smoke-pi-runner.ts` / manual checklist run once on a dev machine with Podman.
3. **Token lifetime vs reuse:** env is fixed at container create, so one token per lease serves several jobs; per-job budget must be reset by the lease manager while the token stays valid. Recommendation: token = per lease (revoked on removal), budget object per job (`proxy.beginJob(leaseToken, jobId)` / `endJob`), requests outside a running job get 429. Alternative (re-render `models.json` per job via putArchive, new token per job) is stricter but depends on Open Question 1.
4. **Pi request shape accepted by the proxy/OpenAI:** compat flags for a custom `baseUrl` (developer role, `max_tokens` vs `max_completion_tokens`, `store`). Recommendation: the proxy normalizes defensively; verify the first live request and add `compat` overrides in `models.json` only if OpenAI rejects something.
5. **Dev-mode reachability** of the proxy from a rootless container (`host.containers.internal` + pasta flags + `vite dev --host`). Recommendation: document the verified recipe in README after the smoke test.
6. **Rootless limits:** CPU/pids cgroup delegation on the target host. Recommendation: smoke test; on failure log a warning and retry create without the offending limit only in dev.
7. **Job submitted while the session's container is `claimed/running`** (double click or second tab): decision needed. Recommendation: second job fails fast with `failed`/"a job is already running in your session" (no extra container, honors D-06).
8. **Job with no output files:** Recommendation: if `output/` is empty after a clean run, write the final assistant text (from the last `message_end`) to `output/result.txt` so the artifact is never empty; if there is no text either, mark `failed` with "agent finished without producing output".

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.0 (`npm test` = `vitest run`) |
| Config file | `vitest.config.ts` (env `node`; components use jsdom; includes `src/**/*.test.ts`, `scripts/**/*.test.ts`) |
| Quick run command | `npx vitest run src/lib/server/tryitout` (or the touched test file) |
| Full suite command | `npm test` |

Existing tests to keep green or update: `src/lib/server/tryItOutRunner.test.ts`, `tryItOutJobs.test.ts`, `tryItOutPrompts.test.ts`, `src/routes/api/tryitout/jobs/jobs.test.ts` (artifact content type/filename, `runJob` dispatch), `src/lib/tryItOut.test.ts` (download filename `.zip`). Pattern: set `TRYITOUT_WORK_DIR` to a tmpdir BEFORE dynamically importing modules (jobs module reads env at load).

### Phase Requirements -> Test Map
| Req (decision) | Behavior | Test Type | Automated Command | File Exists? |
|----------------|----------|-----------|-------------------|-------------|
| D-08/D-09/D-10 | CAS transitions, concurrent claim vs evict, cap, busy, min-idle, reload reuse, per-session replace, TTL reaper (fake timers) | unit (fake runtime) | `npx vitest run src/lib/server/tryitout/leaseManager.test.ts` | Wave 0 |
| D-11/D-12/D-16 | JSONL parser (split chunks, CRLF, unicode separators, garbage), event mapping, completion rule (exit 0 + settled + stopReason, retry failure, timeout) using recorded fixture streams | unit | `npx vitest run .../piEvents.test.ts` | Wave 0 |
| D-11/D-13 | `runJobInContainer` end-to-end with fake runtime: files staged, events pushed in order, output tar -> zip, status/error strings, empty-output fallback | unit/integration (fake) | `npx vitest run .../piRunner.test.ts` | Wave 0 |
| D-13 | zip builder: path traversal names rejected, symlink skipped, size/file caps, round-trip unzip with `fflate.unzipSync` | unit | `npx vitest run .../artifact.test.ts` | Wave 0 |
| D-14 | engine unreachable/start failure -> fallback with warning + notice event; cap-hit -> busy, never fallback; fallback env off -> failed; fallback emits zip with `result.txt` | unit (fake runtime + mocked openai as in existing tests) | `npx vitest run src/lib/server/tryItOutRunner.test.ts` | Update existing |
| D-17/D-22 | proxy: token validation (missing/wrong/revoked), model forced, key injected server-side, stream pass-through, usage accounting, budget 429, body cap, no key at import; mocked upstream `fetch` | unit/route | `npx vitest run src/routes/api/llm` | Wave 0 |
| D-17 | hooks: `/api/llm/` bypasses user auth with AUTH_ENABLED, other `/api/*` still 401 | unit | `npx vitest run src/hooks.server.test.ts` | Wave 0 (check for existing hooks test first) |
| D-05/D-06 | `+page.server.ts` calls `ensureWarm` only for `runnable`, does not await, sets anon cookie when auth off | unit | `npx vitest run "src/routes/agents/[slug]"` | Wave 0 |
| D-02/R-05 | `SKILL.md` has valid frontmatter name/description; fallback prompt loader strips it | unit | `npx vitest run src/lib/server/tryItOutPrompts.test.ts` | Update existing |
| D-21 | create options builder produces CapDrop ALL, limits, tmpfs, labels, no PortBindings, internal network (pure function) | unit | `npx vitest run .../runtimeDockerode.test.ts` | Wave 0 |
| D-01/D-03/D-19/D-20/D-21 live | socket connect (host rootless and app-in-container), internal network DNS to app alias, Pi offline start, ReadonlyRootfs, putArchive/getArchive on tmpfs, exec demux + exit code, `NanoCpus`/pids limits, timeout kill, orphan cleanup on restart, real OpenAI proxy round trip | live smoke (manual, needs Podman + key) | `scripts/smoke-pi-runner.ts` (documented manual run, not part of `npm test`) | Wave 0 |

### Sampling Rate
- **Per task commit:** the touched test file(s) via `npx vitest run <file>`
- **Per wave merge:** `npm test`
- **Phase gate:** full suite green; plus one recorded live smoke run (checklist in the last plan) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Live spike script (needs Podman): confirm putArchive into tmpfs/ReadonlyRootfs, exec demux + ExitCode, `--internal` DNS, compat socket access from app container; its result selects Pattern 3 variant
- [ ] `src/lib/server/tryitout/runtimeFake.ts` — shared fake (scriptable exec stdout JSONL, injected failures, latency, archive store)
- [ ] Recorded Pi JSONL fixtures (success run with read/write tools, model-error run with exit 0, retry failure) hand-written from docs/json.md (no live capture available until smoke test)
- [ ] Test files listed above; framework install: none (vitest present); `npm install dockerode tar-stream fflate` and `@types/dockerode`

## Sources

### Primary (HIGH confidence)
- Pi 1.0.4 npm tarball (`npm pack @earendil-works/pi-coding-agent@1.0.4`, extracted in the scratchpad, read only, nothing executed): `docs/json.md`, `docs/cli.md`, `docs/cli-integration.md`, `docs/skills.md`, `docs/models.md`, `docs/configuration.md`, `docs/environment-variables.md`, `docs/settings.md`, `docs/containerization.md`, `docs/security.md`, `docs/message-types.md`, `CHANGELOG.md`; source `dist/core/agent-session.js` (skill expansion), `dist/main.js` (offline flags), `dist/utils/tools-manager.js`, `dist/core/tools/*.js` (tool arg names), `dist/core/model-config.d.ts` (compat flags)
- npm registry (`npm view`) for versions listed in Standard Stack
- Podman source: raw.githubusercontent.com/containers/podman/main/pkg/api/server/register_archive.go, register_exec.go, pkg/api/handlers/compat/exec.go
- https://docs.podman.io/en/stable/markdown/podman-network-create.1.html (`--internal`: no default route, aardvark-dns resolves container names only)
- https://docs.podman.io/en/latest/markdown/podman-run.1.html (read-only, read-only-tmpfs, tmpfs, cap-drop, pids-limit, no-new-privileges, network-alias, host-gateway)
- Repository files: `src/lib/server/tryItOut*.ts`, `src/routes/api/tryitout/**`, `src/hooks.server.ts`, `src/lib/tryItOut.ts`, `docs/job-api-contract.md`, `Containerfile`, `podman-compose.yml`, `package.json`, `vitest.config.ts`

### Secondary (MEDIUM confidence)
- https://raw.githubusercontent.com/GPT-Laboratory/GAISE26_tool_building_pi_agents/main/backend/src/pool.ts (limits; Docker-oriented, no exec)
- https://oneuptime.com/blog/post/2026-03-18-use-docker-sdk-podman-api-compatibility/view and /2026-03-18-use-podman-rest-api-execute-commands-containers/markdown (compat SDK use, exec stream format)
- oneuptime.com/blog/post/2026-03-17-access-host-loopback-rootless-podman and passt-user mailing list (host.containers.internal vs loopback with pasta)

### Tertiary (LOW confidence, validate in smoke test)
- Docker's "docker cp cannot copy into tmpfs/mounts" restriction recalled from Docker docs (not re-fetched this session) and its applicability to Podman
- Rootless cgroup v2 delegation requirement for CPU limits; `userns_mode: keep-id` behaviour under podman-compose
- SvelteKit CSRF origin check scope (form content types only), from framework knowledge

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH for versions and libraries (registry-verified); MEDIUM that dockerode 5.0.1 works against Podman compat without quirks (not run).
- Architecture: MEDIUM-HIGH; lease/proxy/event design is deterministic and unit-testable; archive-into-tmpfs and rootless socket access are the two unverified engine behaviours.
- Pitfalls: MEDIUM; Pi pitfalls are source/doc-verified, Podman ones come from docs and prior knowledge.

**Research date:** 2026-10-08
**Valid until:** ~2026-10-22 (Pi is shipping patch/minor releases every 1-2 days; pin the version)
