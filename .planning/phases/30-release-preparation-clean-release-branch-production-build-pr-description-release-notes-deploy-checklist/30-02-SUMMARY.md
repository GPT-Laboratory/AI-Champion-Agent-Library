---
phase: 30
plan: 02
requirements: [REL-BUILD]
status: complete
---
# 30-02 Summary: build and smoke on the release branch

- `npm ci` 2m37s; `SEARCH_EMBEDDINGS=off npm run build` exit 0, 20s, peak 897 MB, build/ 5.1 MB, 25 agents ingested (25/0 failed).
- `npm run smoke` exit 0, 36s, peak 910 MB, 104/104 over 8 configurations (same as Phase 16/18). All-off returns 404 for /mcp-test, POST /api/mcp-generate and /api/mcp-test/runs.
- First build attempt failed only because gitignored `db/` did not exist in a fresh checkout (also true on main; Containerfile creates it). Fixed by creating it, no source change; noted for the deploy checklist.
- No source fixes, no OOM. Release tree clean. Full test suite not run (51 flag tests passed in Plan 01).
- Details: release/BUILD-SMOKE.md
