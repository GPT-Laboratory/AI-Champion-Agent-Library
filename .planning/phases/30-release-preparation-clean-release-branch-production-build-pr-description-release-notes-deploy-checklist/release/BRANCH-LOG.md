# Release branch log (Plan 30-01)

- Branch: `release/agents-2026-10` (local only, no upstream, nothing pushed)
- Worktree: `/home/ville/projects/aic-release` (kept for Plan 02; node_modules is a hard-linked copy of the main repo's, untracked)
- SRC: `8e271efa8cb004606023a092b9f9a40f2876f261` (autonomous/overnight-improvements). Base: origin/main `25fa4894` (no fetch performed; existing ref used). merge-base = 25fa489.
- Method: tree snapshot of SRC onto origin/main in a scratch worktree, then exclusions, 5 logical commits (no phase ids in messages). The gsd-pr-branch workflow file does not exist, per plan.

## Finding
origin/main already tracks `.claude/` (179 files) and 27 `.planning/` files. They were restored to origin/main state, so the release diff does not touch them (no deletions, no additions). Ville may want to know the publishing history already contains them.

## Exclusions applied
`.planning/` and `.claude/` (changes not carried), `docs/consortium-agents-inventory.md`, `docs/consortium-agents-gaps.md`, and tests that read `.planning/`: `src/lib/mcpgen/criteria.test.ts`, `src/lib/mcptest/criteria.test.ts` (acceptance-criteria tests that parse planning files; they cannot run without .planning). Checked and absent from tracked SRC: .tryitout-runs, .tryitout-work, .gsd, override.tryitout.yml, db/, .env (only .env.example), runtime/, data/fixtures-scale/, *.db, *.log, spend-log*, AUTONOMOUS-* outside .planning. Kept: docs/tryitout-live-run.md (public doc; Plan 03 sweep to re-check), session.ts files (code, not run logs), per-entry metadata.gaps/assumptions.

## Link / reference edits (minimal)
- README.md: dropped `.planning/` row. .containerignore: dropped `.planning/` line.
- TECHNICAL_DOCUMENTATION.md, docs/deploy-runbook.md (HUMAN-UAT table paths -> "(checklist in this table)"; D-253 path), docs/human-verification-guide.md, docs/mcp-test-platform.md, docs/mcp-generator-design.md, docs/mcp-generator-proposals.md, docs/dependency-health.md, docs/phase13-adapters.md, docs/agent-hosting-decision-memo.md: removed `.planning/...` pointers.
- docs/agent-entry-template.md, docs/templates/agent-entry.template.yaml, data/agents/stk-mcp/catalog.yaml: removed links to the excluded inventory/gaps docs.
- scripts/tryout-run.ts + test + docs/tryitout-live-run.md: default ledger `.planning/spend-log.md` -> `spend-log.md`.
- src/lib/server/tryItOutModel.ts comment; src/lib/mcpgen/proposals/invariants.test.ts: removed one `.planning/exploration/...` file from the scanned list.
- Remaining: `grep -rn "\.planning\|consortium-agents-(inventory|gaps)"` on the release tree returns nothing. Decision ids (D-nnn) and the name "Ville" still appear in some docs (Plan 03 sweep).
- docs/dependency-health.md line 59 still says `vite build` fails on the branch (stale/internal wording; Plan 02 build will confirm and Plan 03 may edit).

## Commits (on 25fa489)
- 5f9433e Add MCP server generator (behind MCP_GENERATOR, off by default)
- 66ff5df Add MCP test platform (behind MCP_TESTER, off by default)
- b7b60ef Add Try It Out runner, prompts and hardening
- 8c62551 Add agent catalog entries, multi-format spec parsing and ingest
- 850dbd8 Catalog UI, accessibility, routes, build config and documentation

## Verification
- `git diff --name-only origin/main...HEAD | grep -E '^(\.planning|\.claude|\.tryitout|db/|override|docs/consortium-agents-(inventory|gaps))'`: 0 lines. Worktree clean. `git branch -r` has no release ref; no upstream.

## Flag-off proof
- vitest: flags.test, flags.mcp.test, flags.mcptest.test, pageFlags, src/routes/mcp-test, src/routes/api/mcp-generate, scripts/flag-off.golden.test.ts: 8 files, 51 tests passed (flag-off golden byte-identical test included).
- grep MCP_GENERATOR|MCP_TESTER|AGENT_KINDS over .env.example, podman-compose.yml, Containerfile, Containerfile.*, .containerignore: no matches (not set anywhere). src/lib/flags.ts: each flag is true only when the env var is a TRUTHY string, so unset = off (lines 8, 16, 40). docs/deploy-runbook.md lines 43, 47, 49 list all three as default "off".
- No default was on; no code fix needed.
