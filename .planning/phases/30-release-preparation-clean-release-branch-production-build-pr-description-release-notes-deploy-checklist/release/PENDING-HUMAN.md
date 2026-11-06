# Pending for Ville (Phase 30)

Release branch: `release/agents-2026-10`, tip f9ef5d0, worktree `/home/ville/projects/aic-release`. Local only; nothing pushed.

## Decisions
1. AGENT_KINDS on or off for the release: off lists 25 agents, on lists 28 (adds STK MCP, STK Catalog MCP, LVI-INFO MCP). Needs a re-ingest if switched.
2. Excluded by default: `docs/consortium-agents-inventory.md` and `docs/consortium-agents-gaps.md`. Approve, or check with the consortium and include. Also decide keep/exclude for the other internal-reading docs using the recommendations in SWEEP.md (table under "Decisions for Ville", e.g. ddc-agent-candidates.md, deploy-runbook.md section 9).
3. Review the SWEEP.md "Decisions for Ville" items, notably the personal GitHub URL (villelaaksotuni/mcp-gen-comparison) in `data/agents/stk-mcp/catalog.yaml` and `data/agents/lvi-info-mcp/catalog.yaml`: keep, change or drop. Remaining "Phase NN"/"D-nnn" cross-references (about 150) are cosmetic.
4. History shape: 5 logical commits plus 2 cleanup commits (7 total). Change to a squash if wanted; confirm the branch name.
5. Minor: add `mkdir -p db` to the db:push script (fresh checkout build fails without it); the Containerfile already does it.

## Manual steps
1. Inspect: `cd /home/ville/projects/aic-release && git log origin/main..release/agents-2026-10 && git diff --stat origin/main...HEAD`.
2. Push yourself to the publishing remote: `git remote add publish <url>` then `git push publish release/agents-2026-10`.
3. Open the PR using `release/PR-DESCRIPTION.md`; RELEASE-NOTES.md and DEPLOY-CHECKLIST.md go with it.
4. Clean up: `git worktree remove ../aic-release` (not done by Claude).

## Deploy side
- Provide OPENAI_API_KEY and the Pi runner image (Containerfile.pi-runner build).
- Containerfile image build and a live Try It Out run were not performed here.
