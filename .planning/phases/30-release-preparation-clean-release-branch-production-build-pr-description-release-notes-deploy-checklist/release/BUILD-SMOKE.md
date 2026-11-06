# Build and smoke on release/agents-2026-10 (final tip f9ef5d0, worktree /home/ville/projects/aic-release)

Machine: 3.7 GB RAM, ~1.4 GB free before runs, Podman idle, nothing else running. No OOM, no retry with lower heap needed.

| Step | Command | Exit | Wall | Max RSS |
|---|---|---|---|---|
| install | `npm ci` (network available) | 0 | 2m37s | n/a |
| build, attempt 1 | `SEARCH_EMBEDDINGS=off npm run build` | 1 | 5s | 174 MB |
| build, attempt 2 | same, after `db/` existed | 0 | 20s | 897 MB |
| smoke | `npm run smoke` | 0 | 36s | 910 MB |

Build used SEARCH_EMBEDDINGS=off (no model download), same as Phase 16/18.

## Build attempt 1 failure (not a code defect)
`drizzle-kit push` failed with "Cannot open database because the directory does not exist": `db/` is gitignored and a fresh checkout has no `db/` directory, so `npm run build` fails on the first run outside the container (the Containerfile does `mkdir -p db`; the same holds on origin/main). The failed run's ingest created `db/`, I deleted the partial `db/catalog.db*` and reran: exit 0. No source change made. Optional hardening for Ville: `mkdir -p db` in the db:push script. Deploy checklist item: build via Containerfile, or `mkdir -p db` first.

## Build output
- `build/` 5.1 MB, `build/index.js` present, `db/catalog.db` present.
- Ingest: "Ingestion complete: 25 succeeded, 0 failed" (25 YAML entries, matches A-01).

## Smoke
104/104 checks passed, 8 configurations x 13 probes, all PASS: all-off, MCP_GENERATOR, MCP_TESTER, AGENT_KINDS, AGENT_COMPARE, UI_DARK_MODE, UI_SPEC_VIEWER, all-on.
Flag-off proof at runtime: in the all-off configuration `/mcp-test` = 404, `POST /api/mcp-generate` = 404, `/api/mcp-test/runs` = 404 (all as wanted). MCP_GENERATOR alone: generate 200, test page 404; MCP_TESTER alone: test page 200, generate 404.

| | Phase 16/18 | Now (release branch) |
|---|---|---|
| smoke | 104/104, 8 configs | 104/104, 8 configs |
| `vite build` embeddings off | exit 0 | exit 0 (via `npm run build`) |
| tests (`npm run check`) | 269 files, 3072 tests (1 skipped) | not run here (Plan 01 ran the 8 flag-related files, 51 tests, pass) |

## Cleanliness
- `git status --porcelain` in the release worktree: empty.
- Working repo `git status --porcelain`: empty before this plan's artefacts; its db/ and node_modules were not touched (the release worktree's node_modules was reinstalled by `npm ci`, which replaced the hard-linked copy from Plan 01 with a separate tree).
- Worktree not removed (Plan 04 lists `git worktree remove ../aic-release` as cleanup).
- Logs: /home/ville/projects/scratch-{ci,build,smoke}.log (outside both trees).

## Re-run on the FINAL tip f9ef5d0 (after the sweep fixes 70ab99b and f9ef5d0), run alone, Podman idle
The tables above were measured on the earlier tip 850dbd8; these are the numbers for the release tip.

| Step | Command | Exit | Wall | Max RSS |
|---|---|---|---|---|
| build | `mkdir -p db`, `SEARCH_EMBEDDINGS=off npm run build` | 0 | 18.9 s | 911 MB |
| smoke | `npm run smoke` | 0 | 35.4 s | 936 MB |
| check | `npm run check` (svelte-kit sync, tsc --noEmit, vitest run) | 0 | 4m12s | 808 MB |

- Build: 25 succeeded, 0 failed ingested. Smoke: 104/104 checks, 8 configurations.
- Check: 271 test files passed (1 skipped of 272), 3075 tests passed (1 skipped of 3076). Svelte a11y warnings only (same class as on the working branch). Working branch at Phase 16/18: 269 files, 3072 tests; the difference is the 2 removed criteria test files and later agent tests.
- No failure was caused by the release exclusions or wording edits, so no fix commits were needed. The tip stays f9ef5d0.
- Logs: /home/ville/projects/scratch-{build2,smoke2,check2}.log
