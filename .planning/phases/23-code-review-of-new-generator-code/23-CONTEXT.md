# Phase 23 Context: Code Review of New Generator Code

Gathered unattended (auto mode). Working branch only. No pushes, no PRs.

## Scope
Per ROADMAP Phase 23: code review (gsd-code-review) and fixes plus a security audit of everything added since the Phase 14 review: Swagger 2.0/OAuth2/3.1 audit, SQL dialects and Prisma, OData and sax, proposals, context pack and evaluation script, binding file, container-path fixes, CLI changes, plus Phases 21-22 changes. Outputs: 23-REVIEW.md, 23-REVIEW-FIX.md, security verdict (SECURED or open threats), final `npm run check`, `vite build`, `npm run smoke`.

## Assumptions
- A-01: Use gsd-code-reviewer / gsd-code-fixer / gsd-security-auditor agents (isolated worktrees for fixers). Review file set: git diff of src/lib/mcpgen, src/lib/mcptest, scripts/generate-mcp.ts, scripts/mcp-*.ts, binding file loader, container files since the Phase 14 review commit (find it in git log).
- A-02: Critical and warning findings are fixed with tests; info findings are listed; accepted ones get a decision id in .planning/AUTONOMOUS-DECISIONS.md.
- A-03: Machine limits: build/smoke/check alone and sequentially.
