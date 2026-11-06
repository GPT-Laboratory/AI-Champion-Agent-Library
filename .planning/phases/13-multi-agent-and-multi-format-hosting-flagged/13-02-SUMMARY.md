---
phase: 13-multi-agent-and-multi-format-hosting-flagged
plan: 02
subsystem: spec-adapters
tags: [registry, adapter, oracle-agentspec, security, fixtures]
requires: [13-01]
provides:
  - parseSubmission/detectFormats/listAdapters registry (never throws)
  - readSubmissionDir capped scanner
  - scanSecrets/redactSecrets/capText
  - Oracle AgentSpec multi-agent adapter (Swarm, ManagerWorkers, Flow, A2AAgent, Agent)
  - stub adapters for plans 04/05 (catalog-manifest, skill, crewai, mcp-server-json, langgraph)
affects: [13-03, 13-04, 13-05]
key-files:
  created:
    - src/lib/spec/registry.ts
    - src/lib/spec/outcome.ts
    - src/lib/spec/scan.ts
    - src/lib/spec/security.ts
    - src/lib/spec/formats/index.ts
    - src/lib/spec/formats/oracle-systems.ts
    - src/lib/spec/formats/manifest.ts
    - src/lib/spec/formats/skill.ts
    - src/lib/spec/formats/crewai.ts
    - src/lib/spec/formats/mcp-server-json.ts
    - src/lib/spec/formats/langgraph.ts
    - fixtures/submissions/ (5 synthetic fixtures)
  modified:
    - .planning/AUTONOMOUS-DECISIONS.md
key-decisions:
  - "D-036 tolerant system reader instead of Zod union"
  - "D-037 placeholder systemPrompt/llm for non-agent records"
requirements-completed: [P13-ADAPT, P13-SECURITY]
completed: 2026-10-12
---

# Phase 13 Plan 02: Registry, scanner, security and Oracle systems adapter Summary

Flag-independent adapter machinery is in place: a never-throwing registry, a capped fs scanner, secret helpers, and a tolerant Oracle AgentSpec reader for Swarm, ManagerWorkers, Flow, A2AAgent and single Agent. Nothing existing was edited (only new files plus the decisions log), so flag-off behaviour is unchanged (golden test passes).

## Commits
1. 642de00 security helpers and directory scanner
2. 3e05518 registry, adapter, stubs, fixtures, decisions

## Deviations from Plan
- [Rule 3 - Blocking] Added `src/lib/spec/outcome.ts` holding `unrecognizedOutcome`, so the stub adapters can import it without an import cycle with `registry.ts` (which imports `formats/index.ts`). `registry.ts` re-exports it.
- Adapter also redacts secrets itself (registry redaction is a second pass), so the adapter is safe when used directly.
- Plan 13-04/05 note: stubs live at `formats/{manifest,skill,crewai,mcp-server-json,langgraph}.ts`; import `unrecognizedOutcome` from `../outcome.js`.

## D-numbers used
D-036, D-037

## Verification
`npm run check` exit 0 (86 files passed, 1 skipped; 824 tests). New tests: security, scan (temp dir), registry, oracle-systems. No existing test file modified, no new dependencies.

## Self-Check: PASSED
