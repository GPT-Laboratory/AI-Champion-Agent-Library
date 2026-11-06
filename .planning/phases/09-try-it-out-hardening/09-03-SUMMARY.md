---
phase: 09-try-it-out-hardening
plan: 03
subsystem: tryitout
tags: [chaos-tests, llm-proxy, budget, jsonl, pi-events]
requires: [09-01]
provides: [chaos.proxy.test.ts, chaos.jsonl.test.ts]
affects: [llmProxy.ts, piEvents.ts, piRunner.ts]
key-files:
  created:
    - src/lib/server/tryitout/chaos.proxy.test.ts
    - src/lib/server/tryitout/chaos.jsonl.test.ts
  modified:
    - src/lib/server/tryitout/llmProxy.ts
    - src/lib/server/tryitout/piEvents.ts
    - src/lib/server/tryitout/piRunner.ts
metrics:
  completed: 2026-10-12
  tasks: 2
---

# Phase 9 Plan 03: Proxy budget and Pi JSONL chaos tests Summary

Offline chaos tests (injected upstream stub, fake runtime) for budget exhaustion, token reuse and adversarial Pi JSONL, with four small fixes for defects they exposed.

## What was built
- `chaos.proxy.test.ts` (39 tests): 20 concurrent requests against a budget that fits 3 (upstream sees exactly 3, rest 429, total <= budget); exact-budget then one more; request-count budget under concurrency; upstream reject/500/aborted stream reconciliation; bad `usage` values; token reuse after endJob/revoke/re-register and across leases; 1000 distinct tokens; header variants; body variants (oversized stream without/with lying Content-Length, invalid/non-object JSON, unknown keys dropped, n/model/store forced, stream_options normalised, missing API key).
- `chaos.jsonl.test.ts` (18 tests): byte-by-byte framing, CRLF/lone CR/empty/unterminated lines, invalid/truncated/NUL/bad-UTF-8 lines, primitives and arrays, 5 MB single line (buffer never above cap, one drop), 100k lines, depth-10k JSON, summary cap with 10 MB args, redaction, tool-call tracking bound, tracker verdict determinism, and the job event cap driven through the real `runJobInContainer` with 60k events.

## Defects found
1. A non-stream upstream `usage` of NaN/Infinity (e.g. `1e999`) made `totalTokens` non-finite, which disabled the budget check (`NaN >= max` is false); negative values reduced spend.
2. A non-stream response with no usable usage was charged nothing, so the token budget could be bypassed (only the request-count cap applied). Streams were already charged the reservation.
3. The mapper's open-tool-call map grew without bound (unique `toolCallId` per start with no end, ids up to 1 MiB).
4. `pushEvent` had no cap: a Pi process could grow the job's event list without bound.
5. A throwing `onRecord` consumer propagated out of the parser into the exec stream handler.
Not defects (documented in tests): `Bearer  x` (two spaces) authenticates as token `x`; a revoked/ended lease token gets 401/429 rather than 403.

## Behavioural changes
- `usageTotal` counts only finite non-negative numbers; anything else is "not reported". Revert commit 5986d32.
- Non-stream responses whose usage is missing/invalid are charged the reserved completion cap (same rule as streams). Visible effect: a job against a provider that omits usage hits its token budget sooner. Revert commit 5986d32.
- `MAX_JOB_EVENTS = 2000` mapped events per job, then one "further progress events omitted" event; mapper remembers at most `MAX_TRACKED_TOOL_CALLS = 1000` open tool calls and ignores `toolCallId`s over 200 chars (their end event shows a generic summary); parser swallows exceptions thrown by its consumer. Revert commit 84e3bbb.

## Deviations from Plan
None beyond the fixes above. The upstream stub is injected through the existing `fetchImpl` seam rather than `vi.stubGlobal('fetch')`. `npm run check` exit 0; package.json untouched.

## Self-Check: PASSED
