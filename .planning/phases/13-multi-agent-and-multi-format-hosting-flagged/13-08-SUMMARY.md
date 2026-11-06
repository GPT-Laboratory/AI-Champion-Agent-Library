---
phase: 13-multi-agent-and-multi-format-hosting-flagged
plan: 08
subsystem: cli
tags: [validate-submission, author-tooling, registry]
requires: [13-02, 13-04, 13-05]
provides: ["npm run validate-submission -- <path> [--json] [--strict]"]
key-files:
  created: [scripts/validate-submission.ts, scripts/validate-submission.test.ts]
  modified: [package.json, .planning/AUTONOMOUS-DECISIONS.md]
decisions: [D-090]
requirements: [P13-CLI]
---

# Phase 13 Plan 08: validate-submission CLI Summary

Author CLI that reports ingestible / partial / missing-from-author per submission using the format registry; read-only, never throws, works with AGENT_KINDS unset.

## What was built
- `validateSubmissionPath`, `formatReport`, `main(argv, io)` exported from `scripts/validate-submission.ts`; npm script `validate-submission`.
- Discovery: folder that is itself a submission is one item; otherwise depth-1 sub-folders and top-level data files; nested layouts (CrewAI `config/`) fall back to one whole-folder item.
- Output scrubbing (`sk-` tokens, control chars, 300-char cap) so parser errors cannot leak secrets; `.env`, symlinks, binaries and oversized files are skipped by `readSubmissionDir` and listed as skipped (relative paths only).
- Exit codes: 2 usage, 1 only with `--strict` and a non-ingestible item, else 0.
- Tests (29): all 13 fixtures, folder/file discovery, nonexistent/empty/binary/oversized/invalid YAML+JSON/alias bomb/symlink/.env/secret cases, `--json` equality, exit codes, two spawned CLI smoke tests.
- `npm run validate-submission -- fixtures/submissions` reports 13 items (7 ingestible, 6 partial).

## Deviations
None. One addition beyond the plan: the nested-layout fallback (needed so `crewai-yaml` reports as one item).

## Verification
`npm run check` exit 0 (105 files passed, 938 tests). Commit: feat(13-08) on branch worktree-agent-a5e295a4aa8eb127b.

## Self-Check: PASSED
