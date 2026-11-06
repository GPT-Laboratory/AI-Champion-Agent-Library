---
phase: 17-optional-ui-features-flagged
status: human_needed
verified: 2026-10-14
execution: outside-gsd-flow
---

# Phase 17 Verification

Status: automated evidence complete; every feature needs a human look in a real browser. Executed outside the normal GSD flow.

## Final verified numbers (main, 2026-10-14)

`npm run check` twice exit 0: 269 test files passed (1 skipped), 3072 tests passed (1 skipped). `SEARCH_EMBEDDINGS=off npx vite build` exit 0. `npm run smoke` 104/104 (8 flag configurations, which include the three flags on).

## Requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| UI-04 raw spec viewer | Delivered, flagged; browser check pending human | jsdom/axe tests, D-300..D-302, E1 |
| DISC-02 comparison view | Delivered, flagged; browser check pending human | load + render tests, flag-off 404, D-360..D-365, E4 |
| UI-02 dark/light mode | Delivered, flagged; browser check pending human | `contrast.dark.test.ts` (45 pairs >= AA), cookie/`data-theme` tests, D-380..D-384, E5 |

## Pending human

Browser checks for the three flags with each flag on and off: `docs/human-verification-guide.md` section 6 (flagged features) and section 7 (flags off). Visual quality of dark mode (contrast is proven by calculation, not by eye), keyboard use of the Compare checkboxes, and readability of the raw spec viewer are not machine-verified.
