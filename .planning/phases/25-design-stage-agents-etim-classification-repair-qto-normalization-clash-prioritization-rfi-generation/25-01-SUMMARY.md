---
phase: 25
plan: 01
status: complete
requirements: [CONS-RUN]
---

# 25-01 Summary

Built the reusable Try It Out run harness and proved the container procedure with one live run.

## Built
- `scripts/tryout-run.ts` (+ test): submit, poll, download artifact, read usage, ledger row (reserved then replaced, atomic), budget guard (exit 3, zero HTTP calls), exit codes 0..5.
- `src/routes/api/tryitout/jobs/[id]/usage/+server.ts` (+ test): flag-gated (`TRYITOUT_USAGE_ENDPOINT=1`) token counts only; documented in `.env.example` and `docs/deploy-runbook.md`.
- `docs/tryitout-live-run.md`, `.planning/spend-log.md`, `25-VERIFICATION.md`, `25-HUMAN-UAT.md`; `.gitignore` entries.

## Live run
Job 1e15df20-234c-4c3f-9def-4b2417fe39ff, demo-rfi-triage, gpt-4.1-mini, 7652 tokens, 3 requests, est. 0.0122 USD, Option A. Ledger total 0.0122 USD.

## Deviations
- The plan assumed no image rebuild; the usage endpoint is compiled in, so a new image `localhost/aic-agent-library:tryitout` was built (original `latest` untouched) and the override sets `image:` to it. Doc updated.
- Compose base URL 127.0.0.1 vs ORIGIN localhost:3000 gave a 403; run with `--origin http://localhost:3000`. A rejected submission with no job id now logs cost 0 instead of the reserve.
