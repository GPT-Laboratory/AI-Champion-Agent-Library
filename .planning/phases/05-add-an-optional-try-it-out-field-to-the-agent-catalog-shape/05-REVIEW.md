---
phase: 05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape
reviewed: 2026-08-19T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/routes/agents/try-it-out.test.ts
  - drizzle/schema.ts
  - src/routes/agents/[slug]/+page.svelte
  - scripts/ingest.ts
  - scripts/ingest.test.ts
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-08-19T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Reviewed the phase 5 addition of the `try_it_out_*` columns to the agents schema, the ingest script's deliberate exclusion of those columns from YAML-sourced upserts, and the agent detail page's mode-conditional rendering of the "Try it out" external link. The core design intent (DB is system-of-record for `try_it_out`, ingest must never clobber a manually-set value) is implemented correctly and is well covered by regression tests in `ingest.test.ts` (fresh-insert defaults, clobber-prevention, `lastIngestedAt` still refreshing). The `+page.svelte` external-mode branch correctly gates on both `tryItOutMode === 'external'` AND a truthy `tryItOutUrl`, matching the "malformed row renders nothing" test case.

Two structural gaps stand out: (1) the `tryItOutMode` enum ("none" | "external" | "runnable") is documented only in a comment — nothing at the DB layer or the TypeScript type layer actually enforces it, so a typo anywhere silently degrades to "no affordance shown" with no error signal; (2) `tryItOutUrl` is rendered directly as an `href` with no scheme validation, and because this column is explicitly *excluded* from the validated `normalize()` ingest pipeline (per the D-05/D-06/D-07 design decisions), it currently has no validation path at all before reaching the browser as a clickable link. Neither risk is exploitable by end users today (both columns are populated by direct DB writes, not by untrusted input), but both are gaps a future admin-UI or bulk-import feature would inherit silently.

## Warnings

### WR-01: `tryItOutMode` has no enforced enum at any layer

**File:** `drizzle/schema.ts:22`
**Issue:** The column comment states "allowed values: none | external | runnable", but this is purely documentation — there is no SQLite `CHECK` constraint, and `typeof agents.$inferSelect` infers `tryItOutMode: string`, not a literal union. Consequently:
- `+page.svelte:63` and `:75` compare `agent.tryItOutMode` against the string literals `'external'` and `'runnable'` with zero compile-time protection — a typo in either literal (or a typo written into the DB via a manual `UPDATE`, as phase 5's own commit message describes doing for `rfi-triage-assistant`) silently falls through to "render nothing," identical to the intended `'none'` behavior. There is no runtime warning, log line, or fallback UI communicating that the row's mode value is unrecognized rather than intentionally "none".
- `ingest.ts:36` and `scripts/ingest.test.ts` both re-encode the literal `'none'` independently of the schema default, so the three sources of truth (DB default, ingest hardcode, UI comparison strings) can drift without any tooling catching it.

**Fix:** Introduce a shared TypeScript union and use it everywhere the value is produced or compared, e.g.:
```typescript
// src/lib/spec/types.ts (or a new shared module)
export const TRY_IT_OUT_MODES = ['none', 'external', 'runnable'] as const
export type TryItOutMode = typeof TRY_IT_OUT_MODES[number]
```
Use `TryItOutMode` in `NewAgentRow`/consumer types, and reference `TRY_IT_OUT_MODES[0]` (or an exported `TRY_IT_OUT_MODE_NONE` constant) instead of the bare `'none'` literal in `ingest.ts`. Optionally also add a SQLite `CHECK (try_it_out_mode IN ('none','external','runnable'))` at the DDL level so malformed values are rejected at write time rather than silently swallowed at render time.

---

### WR-02: `tryItOutUrl` rendered as `href` with no scheme/format validation, and is explicitly outside the validated ingest path

**File:** `src/routes/agents/[slug]/+page.svelte:64-71`, `drizzle/schema.ts:23`, `scripts/ingest.ts:32-38`
**Issue:** `agent.tryItOutUrl` is interpolated directly into an anchor's `href` with no validation that it is an `http(s)` URL:
```svelte
{#if agent.tryItOutMode === 'external' && agent.tryItOutUrl}
  <a href={agent.tryItOutUrl} target="_blank" rel="noopener noreferrer">
```
`target="_blank"` + `rel="noopener noreferrer"` correctly mitigates reverse-tabnabbing, but does nothing to stop a `javascript:` or `data:` URI scheme from being clicked and executed in the new tab. By design (D-05/D-06/D-07), this column is deliberately never populated or refreshed by the validated `normalize()`/ingest pipeline — it's populated exclusively by direct, out-of-band writes to the DB (the phase 5 commit itself did this manually for `rfi-triage-assistant`). That means there is currently *no* code path — ingest-time or render-time — that validates this value before it becomes a clickable link. Today the writers are trusted (direct DB access), but the column has no guardrail if a future admin UI, CSV import, or self-service form starts writing to it.

**Fix:** Add a minimal validation guard at read time (defense in depth, independent of who/what writes the column), e.g. in `+page.server.ts` or a small helper used by `+page.svelte`:
```typescript
function isSafeExternalUrl(url: string | null): url is string {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
```
and gate the external-link branch on `isSafeExternalUrl(agent.tryItOutUrl)` instead of the current truthy check.

## Info

### IN-01: Type-unsafe cast in test masks a schema/runtime mismatch

**File:** `src/routes/agents/try-it-out.test.ts:89`
**Issue:** `renderPage({ tryItOutMode: null as unknown as string })` forces a value the type system says is impossible (`tryItOutMode` is `text(...).notNull()` in `drizzle/schema.ts`, so `AgentRow.tryItOutMode` is `string`, never `null`) through an `as unknown as string` cast to exercise defensive UI code for a state the DB schema claims can't occur. This is a reasonable belt-and-suspenders test for defensive coding, but the double-cast is a code smell that would hide a real type mismatch if `tryItOutMode` were ever changed to be nullable for a legitimate reason.
**Fix:** No change required to ship; consider a one-line comment above the cast (`// DB column is NOT NULL, but UI defensively handles unexpected null/empty from legacy rows`) so future readers don't mistake the cast for a genuine type error to "fix" by loosening the schema.

---

_Reviewed: 2026-08-19T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
