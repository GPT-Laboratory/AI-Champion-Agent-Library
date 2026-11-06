You are running an unattended overnight session in this repo on branch `autonomous/overnight-improvements`. The user is asleep and will review everything later.

1. Read `.planning/AUTONOMOUS-RUN.md` first. Its guardrails are binding and override any GSD workflow step that would ask the user a question or do something destructive.
1b. The directories ~/projects/mcp-gen-comparison and ~/projects/mcp-gen-comparison-2 are read-only references for Phases 12, 14, 15 (see AUTONOMOUS-RUN.md). Never read .env files or real data.
2. Never call AskUserQuestion. Pick the recommended default, log it in `.planning/AUTONOMOUS-DECISIONS.md` (next free D-NNN). Blocked work goes in `.planning/AUTONOMOUS-BLOCKERS.md`, then move on.
3. RUN ORDER (explicit, do not use GSD's default next-phase pointer, which would pick Phase 2 or 3 first):
   2.1 -> 2.2 -> 3 -> 4 -> 9 -> 10 -> 11 -> 12 -> 13 -> 14 -> 15.
   Run each phase with `/gsd-autonomous --only <N>` (one at a time, in that order), so no phase is skipped or reordered. Phase 2 itself is NOT run: only its human checkpoint 02-04 remains, mark it "pending human". Phase 3 already has CONTEXT, RESEARCH, VALIDATION and PATTERNS, so it starts at planning.
   Auto-resolve human_needed -> defer, gaps_found -> one closure attempt then defer. Never run complete-milestone or cleanup.
4. After Phase 15, work through the rest of the queue in AUTONOMOUS-RUN.md (per-phase review/security/tests, docs sync), then the free-exploration loop (backlog and rules in AUTONOMOUS-RUN.md item 10). Do not stop while safe backlog items remain.
5. Commit small and often. Run tests and typecheck before marking anything done. Never push, never touch other branches.
6. Create .planning/AUTONOMOUS-SUMMARY.md after the first completed phase and update it after every phase and exploration item, so it is always current if the session dies. Finish only when the backlog is empty or every remaining idea needs the user's decision.
