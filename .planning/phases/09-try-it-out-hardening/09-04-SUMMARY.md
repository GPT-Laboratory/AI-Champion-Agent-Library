---
phase: 09-try-it-out-hardening
plan: 04
subsystem: docs
tags: [human-uat, decisions, readme, state]
requires: [09-01, 09-02, 09-03]
provides: [09-HUMAN-UAT.md, D-019..D-022]
affects: [README.md, .planning/AUTONOMOUS-DECISIONS.md, .planning/AUTONOMOUS-SUMMARY.md, .planning/STATE.md]
key-files:
  created:
    - .planning/phases/09-try-it-out-hardening/09-HUMAN-UAT.md
  modified:
    - .planning/AUTONOMOUS-DECISIONS.md
    - .planning/AUTONOMOUS-SUMMARY.md
    - .planning/STATE.md
    - README.md
metrics:
  completed: 2026-10-12
  tasks: 2
---

# Phase 9 Plan 04: Human UAT list, decisions and docs Summary

Pending-human live Podman checklist with exact commands, D-019..D-022 decision entries with revert commits, and README/summary/state sync. Documents only; no podman, docker or network command was executed.

## What was built
- `09-HUMAN-UAT.md` (status pending human): nine live checks (smoke script incl. MemorySwap, container hardening inspect, network guard incl. non-internal refusal, owner-scoped sweep, hostile output archive, hung engine via `kill -STOP`, real-model budget, reaper timing, compose-down cleanup) plus a "Known accepted risks" section from the security review. Every checkbox is unchecked.
- Decisions D-019 (engine call bounds), D-020 (usage sanitising), D-021 (event bounds), D-022 (test strategy), each with alternatives, why and revert commits.
- README: Phase 9 hardening note (`APP_INSTANCE_NAME`, the 4096 completion cap, 2000-event cap, 1 MiB line cap, 15 s / 60 s engine bounds).
- `AUTONOMOUS-SUMMARY.md` Phase 9 entry, pending-human item and a question for Ville (add `APP_INSTANCE_NAME` to `podman-compose.yml`?); `STATE.md` Phase 9 status line (phase not marked complete).

## Deviations from Plan
None. Env var names were taken from `.env.example` and the code; `npm run check` exit 0 (65 files passed, 1 skipped, 664 tests); package.json untouched.

## Self-Check: PASSED
