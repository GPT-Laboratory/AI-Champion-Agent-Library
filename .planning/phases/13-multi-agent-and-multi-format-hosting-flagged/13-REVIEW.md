---
phase: 13-multi-agent-and-multi-format-hosting-flagged
reviewed: 2026-10-13T00:00:00Z
depth: deep
files_reviewed: 30
files_reviewed_list:
  - src/lib/flags.ts
  - src/lib/server/kinds.ts
  - src/lib/spec/registry.ts
  - src/lib/spec/scan.ts
  - src/lib/spec/security.ts
  - src/lib/spec/outcome.ts
  - src/lib/spec/kinds.ts
  - src/lib/spec/kinds-ddl.ts
  - src/lib/spec/formats/index.ts
  - src/lib/spec/formats/oracle-systems.ts
  - src/lib/spec/formats/manifest.ts
  - src/lib/spec/formats/skill.ts
  - src/lib/spec/formats/crewai.ts
  - src/lib/spec/formats/mcp-server-json.ts
  - src/lib/spec/formats/langgraph.ts
  - scripts/ingest.ts
  - scripts/validate-submission.ts
  - drizzle/schema.ts
  - src/lib/catalogUrl.ts
  - src/lib/server/search/documents.ts
  - src/lib/server/search/index.ts
  - src/lib/server/search/related.ts
  - src/routes/agents/[slug]/+page.server.ts
  - src/routes/agents/[slug]/+page.svelte
  - src/routes/catalog/+page.server.ts
  - src/routes/catalog/+page.svelte
  - src/lib/components/KindBadge.svelte
  - src/lib/components/SystemMembers.svelte
  - src/lib/components/AgentCard.svelte
  - src/lib/components/FilterBar.svelte
findings:
  critical: 3
  warning: 10
  info: 5
  total: 18
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-10-13
**Depth:** deep
**Files Reviewed:** 30
**Status:** issues_found

## Summary

Reviewed the Phase 13 flag-gated multi-format hosting code: registry, scanner, security helpers, all six adapters, flag-on ingest, validate-submission, flag-gated search/catalog/detail changes and the kind UI components. Several behaviours were confirmed by running the code with tsx on crafted inputs (YAML alias bombs, nested secret shapes, `__proto__` and `constructor` keys, empty slugs, symlinks, arbitrary `crew.json`).

Flag-off invariants hold in practice. The legacy `ingestInto` path is textually unchanged, and the detail and catalog loaders add no query and no key when the flag is off. The only flag-off deltas are:
- the `agent_kinds` table that `drizzle-kit push` creates (additive and unused);
- `Math.min(1, ...)` in `related.ts` (IN-01).

Scanner and parser hardening is mostly good:
- symlinks are skipped;
- size, file-count and depth caps hold;
- YAML alias bombs are stopped by `maxAliasCount`;
- there are no eval or import paths;
- Svelte output is escaped and member slugs are allow-listed;
- the `kind` query parameter is allow-listed before it reaches SQL.

The main defects are:
- secret redaction is bypassable (CR-01);
- slug derivation can collide or be empty (CR-02);
- one adapter passes an unvalidated URL into an `href` (CR-03).

## Critical Issues

### CR-01: Secret redaction misses nested objects, non-`sk-` inline tokens and common credential keys; some adapters have no adapter-level redaction

**File:** `src/lib/spec/security.ts:4-14,20,36-50`, `src/lib/spec/registry.ts:46-62`, `src/lib/spec/formats/crewai.ts` (no redaction), `mcp-server-json.ts`, `langgraph.ts`
**Issue:** The docs and tests claim secret-like values never reach extras and members. Confirmed by running the code on crafted input:
- `key` is inherited through arrays but not through objects. `secrets: {db: hunter2}` and `auth: {value: topsecret}` are stored verbatim, because the child keys `db` and `value` are not on the denylist. Only `headers.Authorization` was caught.
- `KEY_DENY` lacks `auth`, `credential(s)`, `private_key`, `passwd`/`pwd`, `cookie`, `session` and `client_id`. Oracle A2A `connection_config` and Swarm or Flow member fields are stored wholesale (`extras.connectionConfig`, `extras.memberFields`), so credentials there are kept.
- Inline tokens are only recognised as `sk-...`. `ghp_`, `xoxb-`, `AKIA...`, `Bearer ...` and PEM blocks inside free text (skill `bodyExcerpt`, crewai task or goal text, member descriptions) are stored as-is. An inline `sk-` is only redacted if some other value happened to trigger redaction first.
- `scanSecrets` silently stops at depth 20. `redactSecrets` only runs in `registry.ts` when `scanSecrets` found something, and the crewai, mcp-server-json and langgraph adapters never redact themselves. Secrets deeper than 20 levels, or inline `sk-` strings with no other finding, are therefore left untouched for those adapters. Reproduced: a crewai agent goal `key sk-abcdefghijklmnopqrstuvwx here` ends up unredacted in `members[0].description`, and a task description with an `sk-` token is also stored unredacted.
- Extras are never read by any consumer today, so this is secrets at rest in `agent_kinds.extras`. It becomes an exposure as soon as extras are shown or used.

**Fix:**
- Make the walk key-path aware: once any ancestor key matches the denylist, redact every descendant string, not just the direct value.
- Extend `KEY_DENY` with `auth`, `credential`, `private[_-]?key`, `passw(or)?d`, `pwd`, `cookie`, `session`.
- Add a shared `INLINE_SECRET` regex set (`ghp_`, `gho_`, `xox[abprs]-`, `AKIA[0-9A-Z]{16}`, `Bearer\s+\S+`, `-----BEGIN .* PRIVATE KEY-----`) and apply it in both `scanSecrets` and `redactSecrets`.
- Always run `redactSecrets` unconditionally in `registry.parseSubmission` over extras and members, instead of only when `scanSecrets` finds something.
- Redact `members[].description` and `name` too.
- Report truncation or depth overflow as a finding instead of silently returning.

### CR-02: Fixed or empty fallback slugs cause cross-submission overwrite (data loss) and empty primary keys

**File:** `src/lib/spec/formats/langgraph.ts:76-78`, `src/lib/spec/formats/crewai.ts:232,265-266,342`, `src/lib/spec/formats/mcp-server-json.ts:147`, `src/lib/spec/formats/oracle-systems.ts:301`, `src/lib/spec/formats/manifest.ts:178`, `scripts/ingest.ts:243-252,269-271`
**Issue:**
- `ingestKindsInto` scans each sub-directory with root-relative paths. The "folder name" fallbacks therefore never fire: `parts.length >= 2` for langgraph and `>= 3` for crewai-yaml are false for `langgraph.json` or `config/agents.yaml` at the submission root.
- Every such submission gets the same slug (`langgraph-application` or `crewai-crew`). The tests encode this (`ingest.allformats.test.ts:89,100`).
- Within one run, the second submission fails as "duplicate slug". Across runs, the `ON CONFLICT(slug) DO UPDATE` silently overwrites an unrelated earlier submission's `agents` row and its `agent_kinds` sidecar. That is data loss.
- `slugify(name)` returns `''` for names with no ASCII alphanumerics (confirmed: `name: "日本語"` gives `slug: ""`). The Oracle systems and manifest adapters have no fallback, and the empty string is inserted as the primary key and produces `/agents/`.
- The overwrite also keeps the old row's `try_it_out_*` values, because D-07 omits them from the update set. A new skill or system can then inherit a previous agent's runnable or external try-it-out settings.

**Fix:**
- Pass the submission directory name into `parseSubmission` through `ctx`, for example `ctx.hint`, and use it for the fallback title and slug in langgraph, crewai and any other root-level fallback.
- Reject empty slugs in the registry. Add a shared `finalizeSlug(name, fallback)` that falls back to a hint or a short hash.
- In `ingestKindsInto`, refuse an upsert onto an existing row whose `source_format` or `kind` differs unless the submission is the same source. At minimum, reset `try_it_out_*` to `none` when the kind changes.

### CR-03: Oracle system adapter passes `metadata.github_url` unvalidated into an `href` (`javascript:` URL)

**File:** `src/lib/spec/formats/oracle-systems.ts:311` (`placeholderRecord`, `githubUrl: metaStr(meta, 'github_url')`) rendered at `src/routes/agents/[slug]/+page.svelte:79-83`
**Issue:**
- The manifest, crewai and mcp adapters all restrict URLs to http(s), but `placeholderRecord` for Swarm, ManagerWorkers, Flow and A2A copies `github_url` verbatim.
- Confirmed: `github_url: "javascript:alert(document.cookie)"` yields `record.githubUrl === "javascript:..."` with status `partial` and no warning.
- The detail page renders `<a href={agent.githubUrl}>`, and Svelte does not sanitise `href`, so this is a stored `javascript:` link from an untrusted submission.
- `target="_blank" rel="noopener noreferrer"` limits but does not remove the risk (middle-click and copy-link still apply).
- The legacy single-Agent path (`extractMeta`) has the same weakness. This phase added a second, ungated-by-validation route to it.

**Fix:** Apply the same `safeHttpUrl` check used in `manifest.ts` in `placeholderRecord`. Add the warning `github_url is not an http(s) URL; dropped`. Optionally also sanitise at render time in `+page.svelte` or in `flattenRecord`, so the legacy path is covered too.

## Warnings

### WR-01: Ingest silently skips recognized-but-broken directory submissions as "not recognized"

**File:** `scripts/ingest.ts:242-247`
**Issue:** For directories, any `record === null` with status `missing-from-author` is logged as `[SKIP-INFO] not a recognized submission` and is not counted as failed. That status is also returned by adapters for recognised formats that are broken: catalog.yaml without a name, SKILL.md with bad frontmatter or without name or description, server.json with no name, an Oracle Agent that fails Zod validation (`unrecognizedOutcome(["Agent did not validate ..."])`), and crewai with invalid JSON. Authors get no failure, the CI count stays green, and the real reason is hidden.
**Fix:** Only treat `outcome.format === 'unknown'` as skip-info. For any other format with `record === null`, throw and count a failure, logging `outcome.missingFromAuthor` and `warnings`.

### WR-02: Only the first matching document or file is parsed; the rest are silently ignored

**File:** `src/lib/spec/formats/oracle-systems.ts:420-427`, `src/lib/spec/formats/skill.ts:90`, `src/lib/spec/formats/crewai.ts:194` (`files.find(crewFile)`), `manifest.ts:64` (`load`)
**Issue:**
- Oracle `candidates()[0]` is chosen, with systems before agents. A submission directory that holds several Agent YAMLs, or a system plus its agents, yields exactly one record with no warning about the other files.
- `SKILL.md` and `crew.json` are picked with `find`/first-by-sort over the whole submission, with no preference for the shallowest path. Because `readSubmissionDir` sorts paths, `AAA/SKILL.md` beats the root `SKILL.md` (confirmed: slug `aaa`).
- Same for `crew.json` in any subfolder.

**Fix:**
- Prefer the shallowest match (sort by path depth).
- When more than one candidate exists, add a warning listing the ignored files.
- Consider returning `partial` when other candidates were dropped.

### WR-03: Over-broad detectors turn unrelated files into catalog entries

**File:** `src/lib/spec/formats/crewai.ts:282` (`detect` at confidence 0.85), `src/lib/spec/formats/skill.ts:92-97`
**Issue:**
- Any file named `crew.json` or `crew.jsonc` is detected as CrewAI without inspecting content (confirmed: `{"films":[1,2]}` becomes `kind: system, framework: crewai`, slug `crewai-crew`). It outranks SKILL.md (0.8), oracle Agents (0.8) and mcp server.json.
- Any `.md` anywhere in the submission whose frontmatter has `name` and `description` (a blog post, CHANGELOG, docs page) is detected as a Claude subagent. Its whole body, up to 64 KB, is stored as `systemPrompt` and shown in the technical spec.
- Both put arbitrary unrelated content into `extras.unknown` or the system prompt.

**Fix:**
- Require crew content signals (`agents` or `tasks` arrays, or a sibling `agents/` folder).
- Require subagent files to sit in a `.claude/agents/` or `agents/` path, or require a `tools`/`model` key.
- Lower the confidence of weak matches.

### WR-04: Top-level file read in flag-on ingest follows symlinks and ignores size caps

**File:** `scripts/ingest.ts:225-230`
**Issue:**
- Directory submissions go through `readSubmissionDir` (symlink skip, 256 KB per file, 2 MB total, 200 files).
- Top-level `.yaml`, `.yml` and `.json` entries use `stat` (follows symlinks) and `readFile` with no size limit.
- A symlink to a large or sensitive local file, or a very large file, is read in full and handed to the YAML parser.
- This contradicts the scanner's stated policy ("Symlinks are skipped").

**Fix:** Use `lstat`; skip symlinks. Reject files larger than `SCAN_MAX_FILE_BYTES`, or route single files through `readSubmissionDir(abs)`, which already handles a file path.

### WR-05: Catalog "Type" filter excludes agents that have no sidecar row

**File:** `src/routes/catalog/+page.server.ts:23-27,162-166`, `src/lib/server/kinds.ts:31-40,43-53`, `src/lib/components/FilterBar.svelte:77`
**Issue:**
- Cards and detail treat a missing sidecar row as `kind: 'agent'`.
- `listSlugsByKind(db, 'agent')` returns only slugs that have a sidecar row with `kind = 'agent'`, so legacy agents ingested before the flag was turned on disappear under `?kind=agent`.
- `listKinds` is derived from sidecar rows only. In a mixed catalog (some agents without sidecar rows, all sidecar rows `system`), the sidecar yields one kind, so `kinds.length > 1` is false and the Type filter is hidden.
- Both break the "kind absent equals agent" contract used elsewhere.

**Fix:**
- For `kind === 'agent'`, select agents whose slug is not in the sidecar, or whose sidecar kind is `agent`.
- Always include `'agent'` in `listKinds` when `agents` has rows without a sidecar row.

### WR-06: `nodeTypes` is a plain object keyed by author-controlled strings

**File:** `src/lib/spec/formats/oracle-systems.ts:271-274`
**Issue:**
- `nodeTypes[t] = (nodeTypes[t] ?? 0) + 1` with `t` from a Flow node's `component_type`. Confirmed with `component_type: constructor` and `toString`: the stored extras contain `"constructor":"function Object() { [native code] }1"`.
- `__proto__` assignments are silently dropped.
- The same author-keyed plain-object pattern is used for `fields[m.r.ref]` (`memberFields`, line 384) and the `extras[k] = doc[k]` copies of unknown keys (`__proto__` is lost, and an assigned object becomes the prototype of `extras`).
- No pollution of `Object.prototype` occurred, but the stored data is corrupt.

**Fix:** Use `Object.create(null)` or a `Map`, and convert with `Object.fromEntries`. Skip `__proto__`, `constructor` and `prototype` keys explicitly.

### WR-07: Unbounded titles, slugs and member names for several adapters

**File:** `src/lib/spec/formats/crewai.ts:232,342,` (`toMember` `name: a.role ?? a.id`), `oracle-systems.ts:301`, `manifest.ts:178`, `mcp-server-json.ts:147`, `src/lib/spec/kinds.ts:62-73`
**Issue:**
- `title`, `slug` and member `name` and `ref` are only capped by the 256 KB file limit. langgraph and mcp cap the title, but crewai does not cap `crew.name`, and oracle and manifest do not cap `name`.
- A 200 KB name becomes the primary key, the URL, a search-index token and the embedding input (member names are in the search text).
- `members` has an entry count cap but no byte cap, and `parseKindInfoRow` does not cap string lengths either.

**Fix:** Apply `cap(name, 120)` and a slug-length cap (about 80) centrally in the registry (or `finalize`), and cap member `name` (120), `ref` (200) and `description` (300) in `clampMembers`.

### WR-08: validate-submission reports success (exit 0) on internal failure, even with `--strict`

**File:** `scripts/validate-submission.ts:233-236`
**Issue:** The outer `catch` in `main` returns `0`. If anything unexpected throws, a CI gate using `--strict` passes.
**Fix:** Return a non-zero code (for example 3) in the catch. Keep the "never throws" guarantee by returning rather than throwing.

### WR-09: Try It Out suppression for non-agent kinds is presentational only (flag on)

**File:** `src/routes/agents/[slug]/+page.server.ts:42-44`, `src/lib/components/AgentCard.svelte:54`
**Issue:**
- `effectiveMode` coerces `runnable` to `none` only in the detail loader. The catalog card still keys on the raw `tryItOutMode`, so a system or skill row carrying `runnable` (see the overwrite in CR-02) shows a "Try out" button on the card that leads to a page without a panel.
- The backend try-it-out service is not kind-aware at all, and it is the only place that actually blocks execution.

**Fix:** Apply the same coercion in the catalog loader, `kind` is already attached there. Also enforce the kind check inside the try-it-out service (and API routes) rather than in the UI.

### WR-10: Subagent body and other free text stored in the record are never scanned for secrets

**File:** `src/lib/spec/formats/skill.ts:220` (`record.systemPrompt = prompt.text`), `src/lib/spec/registry.ts:46`
**Issue:**
- The registry scans only `kindInfo.extras` and `members`.
- A Claude subagent's whole body (up to 64 KB, often pasted with example keys or tokens) goes into `agents.system_prompt` and is shown on the detail page.
- Summaries and descriptions are likewise unscanned. Redaction is therefore limited to extras, while the same material ends up in the public record.

**Fix:** Run the inline-secret redaction or a warning scan over `record.systemPrompt`, `summary` and `title` too, or at least emit a warning so the author sees it in validate-submission.

## Info

### IN-01: `related.ts` scoring ceiling is stale and now clamps flag-on scores

**File:** `src/lib/server/search/related.ts:20-25,70`
**Issue:** `KIND_WEIGHT` was added to `fallbackScore` but not to `FALLBACK_MAX`, so flag-on fallback scores can exceed 1 and `Math.min(1, ...)` flattens ordering among the best matches. The clamp is also a (numerically negligible) flag-off code change.
**Fix:** Include `KIND_WEIGHT` in `FALLBACK_MAX` and drop the clamp.

### IN-02: Duplicate "secret-like values redacted" warning

**File:** `src/lib/spec/registry.ts:46-63` and adapters (`manifest.ts`, `oracle-systems.ts`, `skill.ts`)
**Issue:** Adapters redact and warn, then the registry scans the (already redacted) result and, if it finds `[redacted]` again... confirmed double message in output: `secret-like values redacted (1): $.headers.Authorization` appears twice. The registry should not re-warn for adapter-redacted values.
**Fix:** Have the registry de-duplicate warnings, or skip warning when the adapter already reported.

### IN-03: Alias-limit YAML failures produce an unexplained "unrecognized" result

**File:** `src/lib/spec/formats/manifest.ts:68-76`, `oracle-systems.ts:78-84`, `crewai.ts:` (`parseYamlStyle`)
**Issue:** A YAML parse error or `maxAliasCount` trip is swallowed (`catch {}` or `return undefined`). The author gets no warning that the file was rejected or why, only "no recognizable definition" (bomb inputs finished in under 40 ms, so the guard itself works).
**Fix:** Record the parse failure message (clamped) in `warnings` per file.

### IN-04: Scanner secret-file filter is narrow and case-sensitive

**File:** `src/lib/spec/scan.ts:31`
**Issue:** Only names starting with the exact string `.env` are skipped. `.ENV`, `.npmrc`, `id_rsa`, `*.pem` and `credentials.json` are read into memory (confirmed). They are not currently stored, but any adapter that later globs them would leak.
**Fix:** Skip a deny-list of well-known secret filenames and extensions case-insensitively.

### IN-05: Error messages echoed into logs and reports can contain submitted values

**File:** `src/lib/spec/formats/oracle-systems.ts:347`, `scripts/ingest.ts:252`, `scripts/validate-submission.ts:35-40`
**Issue:** Zod messages (`Invalid enum value ... received '...'`) and the YAML library's error messages (which include a source excerpt) are logged or printed verbatim. `clean()` redacts only `sk-` tokens in validate-submission; ingest logs unredacted.
**Fix:** Pass messages through the shared redaction and length cap before logging.

---

_Reviewed: 2026-10-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
