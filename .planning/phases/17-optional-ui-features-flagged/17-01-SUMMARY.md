---
phase: 17-optional-ui-features-flagged
plan: 01
subsystem: ui
tags: [feature-flags, spec-viewer, compare, dark-mode]
execution: outside-gsd-flow
status: complete
requires: [2, 10, 13]
provides:
  - UI-04 raw spec viewer behind UI_SPEC_VIEWER (default off)
  - DISC-02 side-by-side comparison behind AGENT_COMPARE (default off)
  - UI-02 dark/light/system theme behind UI_DARK_MODE (default off)
key-files:
  created:
    - src/lib/themeFlag.ts
    - src/routes/compare/
    - .planning/exploration/E1-spec-viewer.md
    - .planning/exploration/E4-compare.md
    - .planning/exploration/E5-dark-mode.md
  modified:
    - src/lib/flags.ts
    - src/app.css
decisions: [D-300..D-302, D-360..D-365, D-380..D-384]
requirements: [UI-04, DISC-02, UI-02]
completed: 2026-10-13
---

# Phase 17: Optional UI Features Summary

**Executed outside the normal GSD flow** (no PLAN files; directly launched exploration agents, notes in `.planning/exploration/E1, E4, E5`).

**Three optional UI features shipped, each behind a default-off flag so the flag-off site is unchanged.**

## Accomplishments

- **UI-04 spec viewer** (`UI_SPEC_VIEWER`, D-300..D-302): collapsed "Raw spec" section on the detail page; shows the re-serialised stored record (ingest does not keep the original YAML), redacted and size-capped.
- **DISC-02 compare** (`AGENT_COMPARE`, D-360..D-365): Compare checkboxes (max 3) in the catalog, server-rendered `/compare?agents=a,b,c` table with differences marked, friendly handling of bad slugs, 404 when the flag is off. Memory, deployment and invocation-style rows are not in the data model and were not invented (D-362).
- **UI-02 dark mode** (`UI_DARK_MODE`, D-380..D-384): cookie preference, `data-theme` stamped server-side (no flash), palette remapped centrally in `app.css`; all 45 colour pairs proven at least AA by `contrast.dark.test.ts`.

## Deviations from the GSD flow

No discuss/plan/verify cycle; requirement ids were attached afterwards (they were v2 items).

## Next

Human browser checks for all three (see VERIFICATION).
