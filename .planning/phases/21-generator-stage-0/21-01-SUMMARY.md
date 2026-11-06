---
phase: 21-generator-stage-0
plan: 01
requirements: [CUST-02]
status: complete
---
# 21-01 Summary: spec text hygiene filter

## What changed
- `src/lib/mcpgen/hygiene.ts` (new): `cleanSpecText(s, max)` and `cleanSpecTextFlagged` (also reports whether instruction-like text was dropped). Removes URLs of every shape (scheme://, www., bare domains, mailto:, markdown links keep their label), markup and template syntax (`<..>`, backticks, `${..}`, `{{..}}`, `<%..%>`), credential-shaped text (via `redactSecrets`, replaced by `[removed]`), control/zero-width/bidi characters, and instruction-like phrases (via `sanitizeSourceText`, markers dropped). Never throws, idempotent, returns '' when nothing remains.
- Shared primitives (`hasControl`, `URL_LIKE`, `MARKUP`) moved from `proposals/hygiene.ts` to `hygiene.ts`; the proposal gate imports them, API and gate-3 reject semantics unchanged.
- `emit/pyutil.ts` `cleanSource` calls `cleanSpecText` before `cleanText`.
- `plan.ts`: operation summary notes and the source-text-copied detection use `cleanSpecTextFlagged`. Entity/field labels, parameter descriptions and docstrings already go through `cleanSource` at emit time (python.ts), so each is filtered once.
- `src/lib/mcpgen/hygiene.test.ts` (new, written first and committed failing): hostile fixtures, idempotence, never-throws, and two `generate()` tests (URL/template in summary and param description do not reach server.py).

## Tests
`npx tsc --noEmit` clean; `npx vitest run src/lib/mcpgen scripts`: all pass except one generator golden (below). Flag-off goldens green.

## Golden churn pending for plan 21-05
- `src/lib/mcpgen/emit/golden.test.ts` "acme-http: server, generated tests and report": the acmeHttp search tool docstring changes from `... See [link removed] for details` to `... See for details` (the filter now removes the link marker). No other golden differs.

## Deviations
None. Tests written to avoid secret-shaped literals (built at runtime).
