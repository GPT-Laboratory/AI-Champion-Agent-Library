# Phase 06 — API Coverage Declaration

**Verdict: No external API integration.**

This phase integrates no external API, SDK, or service. It mocks a *future*
backend entirely client-side with in-memory `setTimeout` timers.

## Why the detector fired
The keyword "agent" appears throughout this phase (`agentId`, "agent detail page")
because the product domain is a catalog of AI agents. No agent runtime, LLM API, or
HTTP service is called.

## Evidence
- `src/lib/tryItOut.ts` contains no `fetch`, `EventSource`, `XMLHttpRequest`, or URL
  literal — verified: `grep -nE "fetch\(|EventSource|XMLHttpRequest|https?://" src/lib/tryItOut.ts` (no matches).
- `src/lib/components/**` and `src/routes/**` contain none either (06-CONTEXT.md D-02,
  ROADMAP Phase 6 Success Criterion 6) — verified by the same grep and by a source
  assertion test in `src/lib/components/TryItOutPanel.test.ts`.
- All job state lives in a module-level `Map` inside `tryItOut.ts`, below the
  "MOCK IMPLEMENTATION — DELETE WHOLESALE" banner (D-08). It does not survive a reload.
- No dependency was added to `package.json` in this phase.

## The endpoints named in docs/job-api-contract.md
`POST /jobs`, `GET /jobs/:id`, `GET /jobs/:id/events`, `GET /jobs/:id/artifact` are the
*future* target the mock is shaped against. They are documented so the later runtime
phase can swap implementations behind the three frozen client functions. None of them
is called, referenced, or configured by any code in this phase.

## When this changes
The future runtime phase (in-process `pi --mode rpc` module — see the
`try-it-out-runtime-architecture` project memory) is when a real integration lands.
That phase — not this one — owns the API coverage matrix, auth, error taxonomy,
timeout/retry policy, and rate-limit handling.
