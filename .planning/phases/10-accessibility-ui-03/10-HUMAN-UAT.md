---
phase: 10-accessibility-ui-03
status: pending human
---

# Phase 10 Accessibility: Human UAT (pending human)

Nothing below was run autonomously. Every item is **pending human** and every checkbox is deliberately unchecked.

Automated coverage that already exists (and what it cannot judge):

- `src/lib/a11y/contrast.test.ts`: WCAG ratios for every text/background and control-border token pair used in the UI (computed from the Tailwind palette, not from rendered pixels).
- axe-core in jsdom (`src/lib/testing/axe.ts`, D-023) on every catalog/detail component and on the composed layout + catalog + detail pages. `color-contrast` is disabled there because jsdom has no layout, so rendered contrast, focus-ring visibility, reflow and real assistive technology are covered only by the items below.

Setup (repo root, local only):

```bash
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci
mkdir -p db && SEARCH_EMBEDDINGS=off npm run db:push && npm run ingest && npm run tryout:configure
SEARCH_EMBEDDINGS=off npm run dev
```

Open http://localhost:5173/catalog (sign in first if the login page appears).

## 1. Keyboard-only walk of the catalog (pending human)

Backs: A11Y-01, 02, 10, 13, 17, 20; `a11y.pages.test.ts`, `Pagination.a11y.test.ts`. Browsers: Chrome and Firefox. Do not touch the mouse.

1. Reload the page and press Tab once.
2. Expected: a "Skip to main content" link appears, clearly visible. Press Enter: focus moves into the main area (next Tab lands on the search box).
3. Type a query, Tab through the filters, change one with the arrow keys, then use Clear filters with Enter or Space. Expected: focus lands on the Category select, never on the page top.
4. Use Clear search. Expected: focus returns to the search box.
5. Tab to each card: "View details" and "Try out" are reachable, in reading order, each with a visible focus ring.
6. Tab to Pagination and press Next several times. Expected: focus stays on the pressed button (or moves to Previous on the last page), the page does not jump to the top of the document.

- [ ] Chrome pass
- [ ] Firefox pass

## 2. Keyboard walk of a detail page (pending human)

Backs: A11Y-26 to 30, 33, 35, 38, 39, 42 to 46; `CustomizeMenu.a11y.test.ts`, `TryItOutPanel.a11y.test.ts`. Use a runnable agent such as `demo-rfi-triage`.

1. Tab through Back to catalog, the external links, the Customize button and the Try it out toggle.
2. Customize: Enter opens the menu and focuses the first item; Up/Down/Home/End move; Enter on an item shows the "Coming soon" note; Escape closes and focus returns to the Customize button.
3. Try it out: Space/Enter toggles the panel (`aria-expanded` changes); type a task, Tab to Run, press Enter; watch the progress feed; Tab into the feed and scroll it with the arrow keys.
4. Open Technical Specification with Enter; Tab to the system prompt box and scroll it with the keyboard.

- [ ] Customize menu works end to end
- [ ] Try it out works end to end
- [ ] Technical Specification and system prompt reachable

## 3. Screen reader announcements (pending human)

Backs: A11Y-07, 08, 17, 38, 42 to 44 and H1. Use NVDA + Firefox (Windows) or VoiceOver + Safari (macOS).

1. Catalog: type a query. Expected: after a short pause one announcement such as "3 agents found", not repeated per keystroke.
2. Change a filter. Expected: the new count is announced.
3. Search for nonsense. Expected: "0 agents found" and the "No agents match" heading is readable.
4. Page forward. Expected: "Page 2 of N" is announced; the Previous/Next buttons are read as "Previous page"/"Next page".
5. Cards: the links read "View details: <agent>" and "Try out <agent>"; headings navigation (H key) lists the agent titles under the page heading.
6. Detail: Customize "Coming soon" note is announced after activating an item; the Try it out progress and the final "Job succeeded" or "Job failed" are announced; external links announce "opens in new tab".
7. Landmarks list (NVDA D / VoiceOver rotor): banner, navigation "Primary", main, search, two named complementary regions on the detail page.

- [ ] NVDA + Firefox (or VoiceOver + Safari) pass, notes recorded

## 4. Visual focus ring (pending human)

Backs: A11Y-04, 15, 58 and H2. In Chrome, Tab through the catalog, detail and login pages. Expected: every focused control has a ring or outline that is clearly visible on white, on the gray header, on gray-50 panels and on indigo buttons; the skip link, selects, Back link, summary, login inputs and Sign out included.

- [ ] Focus ring visible everywhere

## 5. Zoom and reflow (pending human)

Backs: H3. At 200% and 400% browser zoom (about 320 px wide), check catalog, detail and login. Expected: no horizontal scrolling for normal content, no clipped or overlapping controls, filters wrap, the Customize menu stays on screen.

- [ ] 200% zoom
- [ ] 400% zoom / 320 px

## 6. Real-browser colour contrast (pending human)

Backs: H5. Run the axe DevTools extension or Lighthouse accessibility audit on catalog, detail (runnable agent, panel open) and login. Expected: no contrast issues and score 100 for accessibility, or any issue noted here with its element.

- [ ] Catalog clean
- [ ] Detail clean
- [ ] Login clean

## 7. Reduced motion and forced colours (pending human)

Backs: A11Y-24 and H4. Enable "reduce motion" in the OS and hover a card: the shadow should not animate. Enable Windows high contrast (or Chrome forced colours emulation): borders, focus rings and badges remain distinguishable.

- [ ] Reduced motion
- [ ] Forced colours

## 8. Remaining audit rows marked pending human

All rows of `10-AUDIT.md` are either fixed, verified OK or listed above (A11Y-H1 to H6). Add any new finding from the checks above to the audit as a new A11Y row.
