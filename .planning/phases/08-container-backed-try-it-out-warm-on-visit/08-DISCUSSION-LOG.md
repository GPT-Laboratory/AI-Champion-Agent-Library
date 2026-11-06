# Phase 8: Container-backed Try It Out (warm on visit) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-06
**Phase:** 08-container-backed-try-it-out-warm-on-visit
**Areas discussed:** Launching containers, Warm-up lifecycle, Pi run and results, Keys/network/limits

---

## Launching containers

| Question | Options | Choice |
|----------|---------|--------|
| How does the app (in Podman) start Pi containers? | Mount Podman socket / Run app on host / Separate runner service / You decide | Mount the Podman socket |
| Image build/use | One generic image + mounted skill / One image per agent / You decide | One generic image + mounted skill |
| Local dev | Same code, host podman socket / Engine optional, fall back to Phase 7 runner / You decide | Same code, host podman socket |
| Engine API | dockerode over the socket / Shell out to podman CLI / You decide | dockerode |

---

## Warm-up lifecycle

| Question | Options | Choice |
|----------|---------|--------|
| Trigger | Agent detail page / Try it out panel / Catalog card / You decide | Agent detail page |
| Owner | Per visitor session / Shared pool per agent / You decide | Per visitor session |
| Lifetime | Reuse for several jobs with idle timeout / One job then destroy / You decide | Reuse with idle timeout |
| Cap | Global cap + reuse per session / Global cap, reject when full / You decide | Global cap + reuse per session |
| At cap | Evict oldest-idle first / Never evict, always busy / You decide | Evict oldest-idle first, with rules |

**Notes:** User added a lease state machine (warming/idle/claimed/running), eviction only from idle via atomic compare-and-set, minimum idle age ~60 s, max one warm container per session (new page replaces it), idle TTL ~5 min. Cap-hit behavior later revised to "busy, never fallback" (see Pi run).

---

## Pi run and results

| Question | Options | Choice |
|----------|---------|--------|
| Pi mode | RPC warm / JSON per job / Print / You decide | JSON mode, one process per job (against the initial recommendation) |
| Progress feed | Real Pi events / Phase 7 staged lines / You decide | Real Pi events mapped to JobEvents |
| Artifact | Zip of output/ / Single result.txt / You decide | Zip of output/ |
| Phase 7 runner | Keep as fallback / Replace / You decide | Keep as fallback, modified |

**Notes:** JSON mode chosen after the user brought an outside analysis (RPC saves only ~1 s of Node boot; skills scanned at Pi startup; stdin exec hijack risk; orphaned on restart). Claude verified the skill-scan claim in Pi's `docs/skills.md` and noted the "containers are single-use" premise did not match decision D-07 (multi-job reuse), without changing the conclusion. Fallback modified by the user: only when the engine is unreachable or a container fails to start, never at the cap (busy instead); log every fallback as a warning and say so in the feed; same JobEvents and zip format (result.txt inside); on/off via env; tests use a fake runtime.

---

## Keys, network, limits

| Question | Options | Choice |
|----------|---------|--------|
| API key | Env var at creation / Mounted secret file / You decide | Custom: LLM proxy, key never in the container |
| Network | Only the app's LLM proxy / Proxy now, allowlist later / You decide | Only the proxy, via an internal network |
| Resource limits | GAISE defaults, configurable / Tighter / You decide | GAISE defaults, configurable |
| Job limits | Timeout + token budget via proxy / Timeout only / You decide | Timeout + token budget via proxy |

**Notes:** User's proxy design: random per-lease token and base URL as env vars, proxy validates token, enforces per-job token/cost budget, injects the real key, streams through, token revoked at lease end. Verify Pi custom provider base URL (models.json) and container-to-proxy reachability. Network: Podman `--internal`; attach the app as a second network if same user, otherwise a minimal relay container (socat/nginx); verify DNS on the internal network and offline Pi startup; disable update check/telemetry; open egress only in local dev.

---

## Claude's Discretion

Cap/TTL/timeout/budget values within stated ranges and env names; session identification; warm trigger mechanics; module layout; container naming and orphan cleanup; skill format adaptation; dev vs deployment proxy/relay differences.

## Deferred Ideas

Per-agent images and a YAML `runtime:` block; structured inputSchema through the job API; human-approval step; SQLite-persisted jobs; running other creators' agents; shared warm pool per agent.
