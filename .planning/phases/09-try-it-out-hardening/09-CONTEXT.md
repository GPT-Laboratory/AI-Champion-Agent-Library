# Phase 9: Try It Out Hardening - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning
**Mode:** Auto (unattended overnight run)

<domain>
## Phase Boundary
Adversarial review + chaos tests of the Phase 8 container/lease/LLM-proxy code (see .planning/phases/08-*/ incl. 08-REVIEW.md, 08-REVIEW-FIX.md, 08-VERIFICATION.md and the code they cover). All tests use the fake container runtime; NO real containers/podman/docker, no network, no paid LLM calls.
</domain>

<decisions>
## Implementation Decisions
- Part A (review): security review of lease tokens, proxy auth, budget enforcement, path/zip handling (tar/zip extraction, traversal, symlinks, size bombs), network guard. Findings written to 09-SECURITY-REVIEW.md; each fixed (with test) or logged with rationale.
- Part B (chaos tests): lease races (concurrent acquire/release), hung engine (timeouts), budget exhaustion (concurrent spend at the limit), token reuse across leases, oversized/malformed Pi JSONL, reaper timing (fake timers).
- Part C: list live Podman checks that cannot run unattended as "pending human" with exact commands in 09-HUMAN-UAT.md.
- Fixes must keep existing behaviour for valid inputs; behavioural changes logged as D-NNN with revert steps. No new deps.

### Claude's Discretion
All else.
</decisions>
<code_context>Gathered in planning.</code_context>
<specifics>None.</specifics>
<deferred>None.</deferred>
