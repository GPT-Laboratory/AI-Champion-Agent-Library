# E3: more tests on Phase 8 (container-backed Try It Out)

Branch: worktree-agent-a95d8e1318f1ddf17 (based on autonomous/overnight-improvements). No dependencies added; no existing test edited.

## Coverage measurement
`@vitest/coverage-v8` is not installed, so gaps were found by reading the code against the 17 existing test files (leaseManager, chaos.*, service, llmProxy, runtime*, piRunner, piEvents, artifact, jobs route, prompts, mode script).

## Gaps found and tests added (7 new files, about 235 tests)
- `src/lib/server/tryitout/gaps.lease.test.ts`: state transitions (markRunning from idle, release no-ops, discard twice), slug change and eviction rules, cap and minIdle victim choice, start failures (beforeCreate, non-Error throw, timeout, stuck-warming reap at 2x), reap boundary, sweepOrphans owner scoping, shutdown, hung remove; client limiter window, unlimited and bounded table; session cookie validation.
- `gaps.service.test.ts`: admitSession (user, shared "unknown" bucket, existing lease, window, 0 = off), warmForSession never rejecting (engine error, bad config, over cap, disabled, bad skill), staging failure (exec exit nonzero or null, putFiles failure), verifyNetwork memoise and retry, buildWarmFiles slug rejection.
- `gaps.proxy.test.ts`: non-object JSON bodies, empty body, auth schemes, upstream status passthrough with generic text, redacted logging, unreadable error body, thrown fetch, non-JSON 200, usage fallbacks, SSE split chunks, sticky budget flag, buildUpstreamBody invalid caps, redact and publicErrorMessage mapping for every runtime code.
- `gaps.artifact.test.ts`: zipFiles at and over the file and byte limits, unsafe names, unicode and binary round trip, writeArtifactZip/zipOutputDir (invalid id, overwrite, ENOENT, empty dirs, symlinks, deep nesting, file cap), fake runtime contract edges.
- `src/routes/api/tryitout/jobs/jobs.gaps.test.ts`: 400 (types, slug schema), 403 kind gate and ordering, 413 boundaries (task, file), 429 and admission fallbacks, runJob rejection, no leakage; GET status/artifact 404/409 mapping and malformed ids.
- `src/lib/server/tryItOutPrompts.gaps.test.ts`: frontmatter parsing (CRLF, unterminated, invalid YAML, non-object), skill validation limits, loader ordering, composePrompt limits.
- `scripts/set-try-it-out-mode.gaps.test.ts`: absolute values, untouched other rows, missing table or file, exact slug match.

No 401 path exists in `src/routes/api/tryitout/**`; the proxy 401 is covered in `gaps.proxy.test.ts`.

## Bugs and observations
1. Bug, fixed (D-340): `redactSecrets` mangled words such as "task-force" into "ta[redacted]". Separate commit with `redact.regression.test.ts`.
2. Observation, not fixed: `POST /api/tryitout/jobs` caps the task by character count (200 K chars), so multibyte text can be up to about 600 KB. Pinned in `jobs.gaps.test.ts` as FINDING.
3. Observation, not fixed: `setTryItOutMode` is not transactional; a missing second slug leaves the first row updated. Harmless (absolute values, re-run converges). Pinned as OBSERVATION.
