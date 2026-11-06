---
phase: 13-multi-agent-and-multi-format-hosting-flagged
plan: 04
subsystem: spec-adapters
tags: [catalog-yaml, skill, claude-subagent, agent-kinds]
requires: [13-02]
provides: [manifestAdapter, skillAdapter]
key-files:
  created:
    - src/lib/spec/formats/manifest.test.ts
    - src/lib/spec/formats/skill.test.ts
    - fixtures/submissions/manifest-system/catalog.yaml
    - fixtures/submissions/manifest-mcp/catalog.yaml
    - fixtures/submissions/skill-example/SKILL.md
    - fixtures/submissions/claude-subagent/example-reviewer.md
  modified:
    - src/lib/spec/formats/manifest.ts
    - src/lib/spec/formats/skill.ts
    - .planning/AUTONOMOUS-DECISIONS.md
requirements: [P13-ADAPT]
---

# Phase 13 Plan 04: catalog.yaml and SKILL.md / Claude subagent adapters Summary

Rank 2 and 3 adapters: `catalog.yaml` (any kind, universal fallback for code-only frameworks) and a single `skill` adapter covering SKILL.md (kind skill) and Claude subagent .md (kind agent, model aliases kept out of llm.name).

## Commits
- 18d6e0c feat(13-04): catalog.yaml manifest adapter
- 8213d4e feat(13-04): SKILL.md and Claude subagent adapter
- decisions log commit: D-060..D-062

## Behaviour
- manifest: detect 0.9; kinds, members, framework, topology, repo link; invalid kind/maturity/role warn; non-http(s) repo_url dropped; mcp env names only; unknown keys in extras; secrets redacted; missing name gives missing-from-author; missing summary/category gives partial.
- skill: SKILL.md 0.8, subagent 0.6; spec limits warn (+ `valid skill name`); scripts/references/assets listed by path only; subagent body to systemPrompt, tools to toolNames, aliases to extras.modelAlias; plain markdown not detected; never throws.
- Both header comments document assumptions. `formats/index.ts` untouched.

## Decisions / D-numbers used
D-060, D-061, D-062 (appended to AUTONOMOUS-DECISIONS.md).

## Deviations from Plan
None to the plan's scope. Task 2 verify command ran the whole `src/lib/spec` suite (81 tests) plus `tsc --noEmit`: green.

## Deferred Issues
`npm run check` exits 1 in this worktree because of two timeout-only failures in files this plan does not touch: `src/lib/components/a11y.pages.kinds.test.ts` (5 s test timeout, axe) and `src/lib/server/tryitout/chaos.lease.test.ts` (5 s, 200 iterations). Machine load average was about 15 (four parallel executors). With `--testTimeout=60000 --hookTimeout=60000` these files plus jobs.test.ts all pass (29/29). All other tests pass (854). Re-run `npm run check` on an idle machine to confirm exit 0.

## Self-Check: PASSED
Files and commits verified present.
