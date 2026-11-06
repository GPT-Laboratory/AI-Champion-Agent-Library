# Phase 9 Security Review: Try It Out (Phase 8 code)

## Scope

`src/lib/server/tryitout/`: `llmProxy.ts`, `leaseManager.ts`, `runtimeDockerode.ts`, `runtime.ts`, `artifact.ts`, `piEvents.ts`, `service.ts`, `clientLimit.ts`. Includes the deferred Phase 8 findings WR-05, WR-08, WR-09, IN-01, IN-02, IN-04, IN-05 (IN-03 is an accepted risk).

## Method

Adversarial read of each file against the seven areas of 09-01-PLAN (lease tokens, proxy auth, budget, path/archive, network guard, sweep and client limit, JSONL parser). Fake runtime and mocked fetch only; no engine, no network. Each fix was written test-first (tests failed before, pass after).

## Findings

Line numbers refer to the code before the fixes. Behaviour changes are logged as D-016 (budget), D-017 (sweep), D-018 (archive, paths, JSONL).

| ID | Area | Severity | File:line | Issue | Disposition |
|----|------|----------|-----------|-------|-------------|
| SEC-01 (WR-05a) | Budget | medium | llmProxy.ts:140-143 | No completion cap when `max_tokens`/`max_completion_tokens` is absent or non-numeric | fixed 7721f66; test "sends the default completion cap when none (or a non-number) is given" |
| SEC-02 (WR-05b) | Budget | medium | llmProxy.ts:254-265 | Check-then-spend spans an await; concurrent requests all pass the token check | fixed 7721f66 (reserve before await, reconcile after); test "concurrent requests cannot all pass the token budget check", "releases the reservation after a failed upstream call" |
| SEC-03 (WR-05c) | Budget | medium | llmProxy.ts:194-224 | Aborted or usage-less streams record 0 tokens | fixed 7721f66; tests "charges the reservation when a stream ends without usage" and "...errors midway" |
| SEC-04 | Proxy | low | llmProxy.ts:144-150 | Client `stream_options` keys spread through to upstream | fixed 7721f66; test "only forwards include_usage from stream_options" |
| SEC-05 (WR-08) | Sweep | medium | leaseManager.ts:290-294 | Sweep removes containers of every other instance on the same engine | fixed 4936dd9 (`aic.owner` label, same-owner sweep); test "owner-scoped sweep spares containers of a different owner and unlabelled legacy ones" |
| SEC-06 | Client limit | low | clientLimit.ts; routes via `getClientAddress()` | Client key depends on adapter ADDRESS_HEADER/XFF config | accepted: trust is deployment configuration; table is bounded (10k) |
| SEC-07 (WR-09a) | Archive | medium | runtimeDockerode.ts:582 | `collect(entry)` buffers the entry before the size check | fixed; test "rejects an oversized entry from its header before buffering the body" |
| SEC-08 (WR-09b) | Archive | medium | runtimeDockerode.ts:555-589 | Archive/extract streams not destroyed on early exit (and a naive destroy would emit an uncaught PREMATURE_CLOSE) | fixed (try/finally destroy with error listeners); test "destroys the engine archive stream on an early exit" |
| SEC-09 | Archive | low | runtimeDockerode.ts:561-566 | Non-file entries skipped but unbounded in number | fixed (cap maxFiles*10+100); test "rejects an archive with an excessive number of non-file entries"; hardlink/device/fifo skipping covered by "skips hardlink, device and fifo entries" |
| SEC-10 (IN-02) | Archive | low | runtimeDockerode.ts:557,587 | `__proto__` entry dropped by plain-object map | fixed (null-prototype map); test "keeps an entry named __proto__ as an own entry" |
| SEC-11 (IN-01) | Archive | low | runtimeDockerode.ts:412-430 | Unsafe staged path leaves `done` rejected, unhandled | fixed (validate before creating the pack); test "putFiles with an unsafe path rejects without an unhandled rejection" |
| SEC-12 | Paths | low | runtime.ts:96-108 | `.` segments accepted (`a/./b`) although the comment says they are rejected | fixed; test in artifact.test.ts "rejects traversal and absolute names" |
| SEC-13 (IN-04) | Create opts | low | runtimeDockerode.ts:379 | No MemorySwap, swap can double memory | fixed (`MemorySwap = Memory`); test "applies the D-21 limits in tmpfs mode" |
| SEC-14 (IN-05) | JSONL | low | piEvents.ts:44-65 | Line buffer unbounded | fixed (1 MiB cap, drop to next newline, `dropped()` counter); tests "createJsonlParser line cap (IN-05)" |
| SEC-15 (IN-03) | Network | low | podman-compose.yml:36-39 | Pi can reach the whole app on the internal network | accepted: deliberate D-19 second-network design; nginx relay on `/api/llm/` is the documented alternative |

## No finding (evidence checked)

- Token entropy: `randomBytes(32)` base64url; storage by sha256 digest, lookup by Map plus `timingSafeEqual` (llmProxy.ts:65-114). No Math.random.
- Revocation on every terminal path: evict, expire, discard, reap, warm-timeout, stuck warming and shutdown all go through `evictSync`, which calls `tokens.revoke` (leaseManager.ts:98-103); stage failure is covered by an existing test. Re-registering invalidates the old token.
- Token placement: only in container Env (`AIC_LLM_TOKEN`), never in labels, events, logs or error text. Residual: visible to anyone with engine socket access (same trust domain, accepted).
- A token only resolves to its own lease's active job; a token with no job gets 429.
- Authorization variants: scheme match is the case-sensitive "Bearer " and tokens are trimmed; anything else is 401. Stricter than RFC, safe, accepted.
- Body cap is enforced on streamed bytes, not only Content-Length (`readCappedText`).
- Upstream URL, model and store are server-controlled; `n`, `logprobs`, `user`, `metadata` and model override are dropped by the whitelist.
- Upstream error bodies are not leaked (WR-06 verified by existing test).
- Network guard: `verifyNetwork` runs before every create (`beforeCreate`), failure refuses the create, network name and `allowOpenEgress` come from env only. Residual: a successful verification is cached for the process lifetime (a network later recreated non-internal would not be noticed); accepted as an operator-level change.
- CapDrop ALL, no-new-privileges, no ports, no mounts, PidsLimit set.
- Paths: output tar entries other than `file` are skipped and never followed; traversal, absolute, backslash, NUL and empty segments rejected; zip names re-validated in `zipFiles` with file-count and byte caps; the fs `collect()` skips symlinks.

## Accepted risks

SEC-06, SEC-15, plus the three residuals above (cached network verification, token visible in engine inspect, strict Bearer parsing). Operator note from SEC-05: set `APP_INSTANCE_NAME` for compose deployments, because the hostname fallback changes whenever the container is recreated.

## Out of scope

Real engine behaviour (no containers run), upstream provider security, auth/login routes, Pi itself.
