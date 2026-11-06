# E1 - UI-04 raw AgentSpec viewer

## What
Behind `UI_SPEC_VIEWER` (default off) the agent detail page gets a collapsed "Raw spec" section (button with `aria-expanded`/`aria-controls`, region, focusable scrollable `<pre>`). It shows the agent's spec as YAML with light syntax colouring (keys, strings, numbers/bools/null, comments).

## Why / source of the text
Ingest does not keep the original YAML (it flattens to table columns), so the text is the stored canonical record re-serialised (`src/lib/specViewer.ts` `buildSpecText`). No file reads, no schema change. Try-it-out settings are left out. Decisions D-300..D-302.

## Safety
- Server side: `redactSecrets` then `capText` 32 KB before the text reaches the page data.
- Client side: own tokenizer, output rendered as escaped text spans; a test feeds `<img onerror>` and asserts no element is created.
- Flag off: loader adds no key (`specViewerData`), keys asserted exactly; DOM compared to a pre-change baseline fixture (inert `<!---->` anchor and one whitespace node normalised).

## How verified
`src/lib/specViewer.test.ts` (flag, redaction, cap, tokenizer round trip) and `src/routes/agents/specviewer.test.ts` (flag-off DOM and loader keys, flag-on loader, collapse/keyboard, escaping, axe collapsed and expanded). `npm run check` and `SEARCH_EMBEDDINGS=off npx vite build` exit 0.

## Pending human browser check
Run with `UI_SPEC_VIEWER=1`: open an agent page, toggle "Raw spec" with Enter/Space, Tab into the YAML box and scroll it with arrow keys, check colours/contrast in the real theme, long prompts, and that a `systemPrompt` containing a token shows `[redacted]`. No copy button (optional, not built).
