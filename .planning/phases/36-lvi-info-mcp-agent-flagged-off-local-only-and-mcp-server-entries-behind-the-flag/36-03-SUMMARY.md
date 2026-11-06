# 36-03 Summary: Pi extension staging (flagged)

## Built
- `src/lib/server/localMcp/extensionTemplate.ts`: `renderLviExtension({baseUrl, callBudget})`, import-free module text generated from one tool table (5 allow-listed tools, object schemas, additionalProperties false, maxLength 64 on strings, bounds in descriptions). URL validated (http/https, no credentials) and embedded via JSON.stringify; budget integer 1..50. Execute: own counter ("tool call budget exhausted" before fetch), AIC_LLM_TOKEN check before fetch, POST `<base>/tools/<name>` with bearer and `{arguments}`, throws on non-ok or `ok:false`, returns text prefixed "UNTRUSTED TOOL DATA ...".
- `src/lib/server/localMcp/agents.ts`: `localMcpAgent(slug)` (null when flag off or other slug) and `localMcpBaseUrl`.
- `service.ts`: `buildWarmFiles` optional `extraFiles`; `stage()` adds `extensions/` dir and `extensions/lvi-info.ts` for registered slugs.
- `piRunner.ts`: `buildPiArgs(cfg, slug, hasUpload, extension = localMcpAgent(slug))` adds `-e <path>` before `--skill` and the 5 names to `--tools`; `--no-extensions`, `--no-mcp` stay; no bash. runJobInContainer unchanged.
- `tryItOutPrompts.ts`: flag-gated fallback to data/tryitout-prompts-local (D-641).
- Decisions D-640, D-641.

## Tests (fake runtime only)
extensionTemplate 7 (loads rendered module, stubbed fetch), tryItOutPrompts.local 4, localMcpStaging 12 (flag-off deep-equal of buildWarmFiles, argv for 4 slug/upload cases against an independent literal, staged file set; flag-on existing slug identical; LVI staging content, argv, canary env not leaked). Existing piRunner/service/runtime tests unchanged and green.

## Verification
`npm run check`: 328 files passed / 1 skipped, 3957 tests passed / 1 skipped. runtimeDockerode.ts, runnerConfig.ts, compose, Containerfiles, check-ddc-decoupling.sh untouched (git diff empty); no DDC agent touched; no Podman, no spend.

## Deviations / notes
Staging tests were written together with the code (extension tests were seen failing first). data/tryitout-prompts-local/lvi-info-product-match/SKILL.md does not exist yet (agent entry belongs to 36-04).
