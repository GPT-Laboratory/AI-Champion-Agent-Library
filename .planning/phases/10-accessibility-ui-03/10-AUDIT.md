# Phase 10 Accessibility Audit (UI-03)

Audited: 2026-10-12, against WCAG 2.2 AA basics. Plan 10-02 fixes every row marked `fix 10-02`; rows marked `pending human` need a person (screen reader, visual judgement) and are collected in 10-HUMAN-UAT.md by plan 10-03.

## 1. Method and scope

- Read every file listed in the 10-01 plan context (layout, catalog, detail, login, SearchBar, FilterBar, Pagination, AgentCard, TechAccordion, CustomizationPanel, CustomizeMenu, TryItOutPanel, TryOutPanel) plus `src/app.css` and `src/app.html`.
- Contrast ratios computed with `src/lib/a11y/contrast.ts` (Tailwind v4 oklch palette converted to sRGB), enforced by `contrast.test.ts`.
- Tooling for later plans: `expectNoAxeViolations` (axe-core in jsdom, color-contrast off) in `src/lib/testing/axe.ts` (D-023).
- Tailwind v4 preflight does NOT remove default focus outlines, and `src/app.css` only imports tailwindcss. Controls without a custom ring therefore show the browser default outline; controls with `outline-none` plus a weak ring do not (login inputs). The default outline is not guaranteed visible on every background, so 10-02 adds one global `:focus-visible` rule.
- Scope exclusions: dark mode (UI-02), the not-yet-built features, and the raw spec viewer (UI-04). Server-side behaviour is unchanged.

Severity: blocker = a keyboard or screen reader user cannot complete a task; major = significant barrier or clear AA failure; minor = friction or advisory.

## 2. Findings per surface

### Layout (`src/routes/+layout.svelte`)

| ID | Severity | WCAG SC | Location | Finding | Disposition |
|----|----------|---------|----------|---------|-------------|
| A11Y-01 | major | 2.4.1 Bypass Blocks | +layout.svelte:6-22 | No skip link; keyboard users tab through the brand link and Sign out on every page before content. | fix 10-02: first-focusable `<a href="#main-content">Skip to main content</a>`, `sr-only focus:not-sr-only` with AA-contrast styling |
| A11Y-02 | minor | 1.3.1 / 2.4.1 | +layout.svelte:20 | `<main>` has no id/tabindex so it cannot be a skip target or receive focus. | fix 10-02: `<main id="main-content" tabindex="-1">` with `focus:outline-none` |
| A11Y-03 | minor | 1.3.1 Info and Relationships | +layout.svelte:8-18 | Header holds brand link and sign-out form but no `<nav>` landmark. Header is an implicit banner (it is not inside sectioning content), which is fine. | fix 10-02: wrap in `<nav aria-label="Primary">` |
| A11Y-04 | minor | 2.4.7 Focus Visible | +layout.svelte:9,14 | Brand link and Sign out have no custom focus style (browser default only). | fix 10-02 (global `:focus-visible` rule in app.css) |

### Catalog page (`src/routes/catalog/+page.svelte`)

| ID | Severity | WCAG SC | Location | Finding | Disposition |
|----|----------|---------|----------|---------|-------------|
| A11Y-05 | major | 2.4.2 Page Titled | catalog/+page.svelte (no svelte:head) | No per-route title: the tab and the SvelteKit route announcer both say the generic "AIC Agent Library" from app.html. | fix 10-02: `<svelte:head><title>Agent Catalog — AIC Agent Library</title>` |
| A11Y-06 | major | 1.3.1 | catalog/+page.svelte:67 and AgentCard.svelte:19 | Heading order h1 (page) then h3 (card titles); level 2 is skipped. | fix 10-02: AgentCard title becomes `<h2>`; update tests that query `level: 3` |
| A11Y-07 | minor | 4.1.3 Status Messages | catalog/+page.svelte:86-90 | The degraded-search notice is a `role="status"` node inserted into the DOM together with its text. Live regions created with content are frequently not announced. | fix 10-02: announce through a persistent live region (see A11Y-08) and keep the visual notice |
| A11Y-08 | minor | 4.1.3 | catalog/+page.svelte:92-101, SearchBar.svelte:63 | Result count is announced by SearchBar's persistent `aria-live` region (good, fed by `data.total`, so it also updates when filters change without a query). The no-results heading and degraded message are not announced beyond "0 agents found". | fix 10-02: one persistent region; choice recorded in 10-02 summary |
| A11Y-09 | minor | 2.4.3 Focus Order | catalog/+page.svelte:63 | Filter and query changes use `keepFocus: true`, so focus stays where it is (correct). | verified OK |

### SearchBar (`src/lib/components/SearchBar.svelte`)

| ID | Severity | WCAG SC | Location | Finding | Disposition |
|----|----------|---------|----------|---------|-------------|
| A11Y-10 | major | 2.4.3 Focus Order / 2.4.7 | SearchBar.svelte:53-61 | "Clear search" button unmounts when clicked (`{#if text}`), so focus falls to `body`. | fix 10-02: focus the input after clear |
| A11Y-11 | major | 1.4.11 Non-text Contrast | SearchBar.svelte:51,57 | Input and button border `gray-200` on white is 1.24:1 (need 3:1). | fix 10-02: `border-gray-500` (4.84:1) |
| A11Y-12 | minor | 2.4.7 | SearchBar.svelte:51 | `focus-visible:ring-2 ring-indigo-600` present (6.46:1). | verified OK |

### FilterBar (`src/lib/components/FilterBar.svelte`)

| ID | Severity | WCAG SC | Location | Finding | Disposition |
|----|----------|---------|----------|---------|-------------|
| A11Y-13 | major | 2.4.3 / 2.4.7 | FilterBar.svelte:65-72 | "Clear filters" unmounts when filters clear, focus falls to `body`. | fix 10-02: move focus to the Category select |
| A11Y-14 | major | 1.4.11 | FilterBar.svelte:24,39,54 | Select borders `gray-200` on white (1.24:1). | fix 10-02: `border-gray-500` |
| A11Y-15 | minor | 2.4.7 | FilterBar.svelte:24,39,54,68 | Selects and Clear button have no focus-visible utility (default outline only). | fix 10-02 (global rule plus explicit ring on the button) |
| A11Y-16 | minor | 4.1.2 / 1.3.1 | FilterBar.svelte:19 | Three selects are not grouped; "Clear filters" has no `type="button"`. | fix 10-02: `role="group" aria-label="Filter agents"`, `type="button"` |

### Pagination (`src/lib/components/Pagination.svelte`)

| ID | Severity | WCAG SC | Location | Finding | Disposition |
|----|----------|---------|----------|---------|-------------|
| A11Y-17 | major | 2.4.3 | Pagination.svelte:11-15 | `goto` without `keepFocus`: SvelteKit resets focus to the document after navigation, so a keyboard user loses their place on the Next button, and the new page is not announced (no live text). | fix 10-02: `keepFocus: true`; the `Page X of Y` span is `aria-live="polite"` with `aria-current="page"`; on the last or first page the pressed button becomes disabled so move focus to the opposite button |
| A11Y-18 | minor | 2.5.3 Label in Name | Pagination.svelte:20-34 | Visible "Previous"/"Next" are ambiguous out of context. | fix 10-02: `aria-label="Previous page"`/"Next page" (visible text is contained in the name) |
| A11Y-19 | minor | 1.4.11 | Pagination.svelte:23,31 | Button border `gray-200` (1.24:1). | fix 10-02: `border-gray-500` |

### AgentCard (`src/lib/components/AgentCard.svelte`)

| ID | Severity | WCAG SC | Location | Finding | Disposition |
|----|----------|---------|----------|---------|-------------|
| A11Y-20 | major | 2.5.3 Label in Name | AgentCard.svelte:43 | Visible text "View details", accessible name "X — view agent details": the visible string "View details" is not contained in the name. Fails 2.5.3. | fix 10-02: `aria-label="View details: {title}"` (keep tests green, update the expected name) |
| A11Y-21 | minor | 2.5.8 Target Size (Min) | AgentCard.svelte:40-46 | "View details" is a bare text link about 20px tall (below 24px AA minimum, below the project 44px convention). | fix 10-02: `inline-flex min-h-[44px] items-center` |
| A11Y-22 | minor | 2.4.7 | AgentCard.svelte:42 | `focus-visible:ring-2` on an inline link without outline reset: ring plus default outline. | verified OK (global rule covers it) |
| A11Y-23 | minor | 3.2.5 / G201 advisory | AgentCard.svelte:56-64 | External "Try out" link opens a new tab with no warning. | fix 10-02: visually hidden " (opens in new tab)" suffix; label-in-name holds ("Try out X (opens in new tab)") |
| A11Y-24 | minor | 2.3.3 Animation (AAA) | AgentCard.svelte:17 | `transition-shadow` ignores reduced motion. Tiny effect. | fix 10-02: `motion-reduce:transition-none` |
| A11Y-25 | minor | 1.4.1 Use of Colour | AgentCard.svelte:20-26 | Maturity is conveyed by badge colour plus the text label. | verified OK |

### Detail page (`src/routes/agents/[slug]/+page.svelte`)

| ID | Severity | WCAG SC | Location | Finding | Disposition |
|----|----------|---------|----------|---------|-------------|
| A11Y-26 | minor | 1.1.1 / 2.4.4 | agents/[slug]/+page.svelte:18-20 | "&larr; Back to catalog": the arrow glyph is read aloud ("leftwards arrow"). No custom focus style. | fix 10-02: wrap the arrow in `<span aria-hidden="true">` |
| A11Y-27 | minor | 3.2.5 advisory | +page.svelte:55-74 | Two `target="_blank"` links give no new-tab warning; the trailing `&rarr;` is also read. | fix 10-02: `sr-only` " (opens in new tab)", arrow `aria-hidden` |
| A11Y-28 | minor | 4.1.2 | +page.svelte:81-93 | "Try it out" toggle has `aria-expanded` but no `aria-controls` and the controlled region has no id. | fix 10-02: `aria-controls="try-it-out-panel"`, id on the wrapper (exists only when open, fine for expanded=false) |
| A11Y-29 | minor | 2.4.3 | +page.svelte:79-100 | Opening the panel keeps focus on the toggle; panel follows in DOM order so the next Tab enters it. | verified OK (decision: not moving focus, avoids surprise) |
| A11Y-30 | minor | 1.3.1 | +page.svelte:109-123, TryItOutPanel.svelte:104 | Two `<aside>` complementary landmarks (customization panel and try-it-out panel) with no accessible names. | fix 10-02: `aria-labelledby` on both asides (heading ids); axe `landmark-unique` is the test in 10-03 |
| A11Y-31 | minor | 1.4.3 | +page.svelte:18 | Back link `gray-500` on white is 4.84:1 (passes). | verified OK |
| A11Y-32 | minor | 2.4.2 | +page.svelte:13-15 | Title already set per agent. | verified OK |

### TechAccordion (`src/lib/components/TechAccordion.svelte`)

| ID | Severity | WCAG SC | Location | Finding | Disposition |
|----|----------|---------|----------|---------|-------------|
| A11Y-33 | minor | 2.4.7 | TechAccordion.svelte:21 | `<summary>` has no focus style (default outline only; the select-none/cursor styling is fine). | fix 10-02: `focus-visible:ring-2 ring-indigo-600 rounded` |
| A11Y-34 | minor | 1.3.1 | TechAccordion.svelte:25-64 | Label/value rows are `div`+`span` pairs rather than a definition list. Reads acceptably. | verified OK (leave; tests query text) |
| A11Y-35 | minor | 2.1.1 Keyboard | TechAccordion.svelte:62 | `<pre>` with `overflow-y-auto max-h-48` is a scrollable region; axe `scrollable-region-focusable` requires keyboard access. | fix 10-02: `tabindex="0"` plus `aria-label="System prompt"`, `role="region"` |

### CustomizationPanel (`src/lib/components/CustomizationPanel.svelte`)

| ID | Severity | WCAG SC | Location | Finding | Disposition |
|----|----------|---------|----------|---------|-------------|
| A11Y-36 | minor | 1.3.1 | CustomizationPanel.svelte:24-25 | Heading is h2 under the page h1 (fine), but the `<aside>` has no accessible name (see A11Y-30). | fix 10-02 (with A11Y-30) |
| A11Y-37 | minor | 1.4.3 | CustomizationPanel.svelte:31 | `indigo-700` on `indigo-50` badge 7.24:1. | verified OK |

### CustomizeMenu (`src/lib/components/CustomizeMenu.svelte`)

| ID | Severity | WCAG SC | Location | Finding | Disposition |
|----|----------|---------|----------|---------|-------------|
| A11Y-38 | minor | 4.1.3 | CustomizeMenu.svelte:117 | `role="status"` note is inside `{#if open}` but exists with the menu and its text changes afterwards, so it is announced. | verified OK (kept; also noted in section 3) |
| A11Y-39 | minor | 4.1.2 | CustomizeMenu.svelte:102-115 | `aria-disabled` menuitems stay focusable and give feedback; Esc returns focus to the trigger. | verified OK |
| A11Y-40 | minor | 1.1.1 | CustomizeMenu.svelte:89 | Arrow glyph `aria-hidden`. | verified OK |
| A11Y-41 | minor | 1.4.1 / 1.4.3 | CustomizeMenu.svelte:108 | Disabled-looking items use `gray-500` text (4.84:1 on white, 4.63:1 on gray-50 hover), still AA. | verified OK |

### TryItOutPanel (`src/lib/components/TryItOutPanel.svelte`)

| ID | Severity | WCAG SC | Location | Finding | Disposition |
|----|----------|---------|----------|---------|-------------|
| A11Y-42 | major | 4.1.3 Status Messages | TryItOutPanel.svelte:134-146 | The progress feed gets new lines and status changes (queued, running, done) with no live region, so screen reader users get no progress feedback. | fix 10-02: feed `role="log"` `aria-label="Progress"` (implicit polite) with `tabindex="0"` for scrolling; the persistent wrapper is rendered when `status !== 'idle'` and events stream in afterwards |
| A11Y-43 | major | 4.1.3 | TryItOutPanel.svelte:158-164 | The "Job failed" block appears silently. | fix 10-02: `role="alert"` |
| A11Y-44 | minor | 4.1.3 | TryItOutPanel.svelte:148-156 | "Download results" appears silently when the job succeeds. | fix 10-02: a persistent `sr-only` `role="status"` region announcing "Job succeeded"/"Job failed"/"Job running" |
| A11Y-45 | major | 1.4.11 | TryItOutPanel.svelte:112,121 | Textarea and file input borders `gray-200` on white (1.24:1). | fix 10-02: `border-gray-500` |
| A11Y-46 | minor | 1.3.1 | TryItOutPanel.svelte:135 | "Progress" label is a `<p>`. | fix 10-02: becomes the log's `aria-labelledby` target |
| A11Y-47 | minor | 3.3.2 | TryItOutPanel.svelte:107-123 | Inputs have visible labels (`for`/`id` pairs), and the placeholder is only a hint. | verified OK |
| A11Y-48 | minor | 1.4.3 | TryItOutPanel.svelte:129 | Disabled Run button `gray-400` on `gray-100` (about 2.3:1): disabled controls are exempt from 1.4.3. | verified OK |

### TryOutPanel (`src/lib/components/TryOutPanel.svelte`)

Not imported by any route or component (only `TryOutPanel.test.ts`): legacy, minimal fixes only.

| ID | Severity | WCAG SC | Location | Finding | Disposition |
|----|----------|---------|----------|---------|-------------|
| A11Y-49 | minor | 2.5.3 / 4.1.2 | TryOutPanel.svelte:178-190 | Labels wrap inputs AND inputs carry `aria-label` equal to the plain label, so the accessible name drops the " *" and unit shown visibly. | verified OK (unused; not touching) |
| A11Y-50 | minor | 1.4.11 | TryOutPanel.svelte:187,199 | `border-gray-300` input borders (1.47:1) and `focus:` rings. | fix 10-02 only as a cheap token swap to `border-gray-500` if tests stay green; otherwise `pending human` (legacy) |

### Login (`src/routes/login/+page.svelte`)

| ID | Severity | WCAG SC | Location | Finding | Disposition |
|----|----------|---------|----------|---------|-------------|
| A11Y-51 | major | 2.4.7 / 1.4.11 | login/+page.svelte:48,75 | Inputs use `focus:outline-none focus:ring-2 focus:ring-blue-200`: the ring (blue-200 on white, about 1.5:1) is nearly invisible; only the border colour change signals focus. | fix 10-02: `focus-visible:ring-blue-700` and keep the global outline |
| A11Y-52 | major | 1.4.11 | login/+page.svelte:48,75 | Input border `gray-300` on white 1.47:1. | fix 10-02: `border-gray-500` |
| A11Y-53 | minor | 3.3.1 Error Identification | login/+page.svelte:20-24 | Error is a `role="alert"` block (announced), but not associated with the input. | fix 10-02: `id="login-error"`, `aria-describedby` on the input when `form?.error` |
| A11Y-54 | minor | 2.4.7 | login/+page.svelte:53,61,78 | Submit and "Send a new code" buttons have no focus style (default only). | fix 10-02 (global rule) |
| A11Y-55 | minor | 4.1.3 | login/+page.svelte:32-36 | The success message after "Send a new code" has no role, but the page reloads (full POST, no enhance) so it is read as page content. | verified OK |
| A11Y-56 | minor | 1.3.5 Identify Input Purpose | login/+page.svelte:44-45,72 | `autocomplete="one-time-code"` and `"email"` are present. | verified OK |
| A11Y-57 | minor | 2.4.2 | login/+page.svelte:8-10 | Title already set. | verified OK |

### Cross-cutting

| ID | Severity | WCAG SC | Location | Finding | Disposition |
|----|----------|---------|----------|---------|-------------|
| A11Y-58 | minor | 2.4.7 | src/app.css | No global focus style; browser default only, and some controls reset the outline. | fix 10-02: `@layer base { :focus-visible { outline: 2px solid indigo-600; outline-offset: 2px } }` |
| A11Y-59 | minor | 3.1.1 | src/app.html:2 | `lang="en"` set. | verified OK |
| A11Y-60 | minor | 1.3.1 | catalog/+page.svelte:103-107 | Card grid is a set of `<article>` elements, not a list; list semantics would announce the count. The live region already announces the total. | verified OK |

## 3. Already verified OK (Phase 3 / Phase 2 work)

- SearchBar: `role="search"`, visible-hidden label "Search agents", persistent `aria-live="polite"` count, 200 ms debounce, `maxlength`, 44px height.
- CustomizeMenu: arrows, Home, End, wrap, Escape returns focus to the trigger, Tab closes without trapping, `aria-haspopup`/`aria-expanded`/`aria-controls`, `aria-disabled` items still focusable, status note after activation.
- Touch targets use `min-h-[44px]` on the search input, selects, Pagination and primary buttons (exceptions: A11Y-21).
- Pagination is a `<nav aria-label="Pagination">` with real disabled buttons.
- `<html lang="en">`, per-route titles on detail and login, labels for every form field, and badge colour never the only indicator.

## 4. Contrast results (from `contrast.test.ts`)

| Ratio | Required | Pair | Verdict |
|-------|----------|------|---------|
| 1.24:1 | 3 | input border gray-200 on white (search, selects, pagination, try-it-out) | FAIL (A11Y-11, 14, 19, 45) |
| 1.47:1 | 3 | input border gray-300 on white (login, legacy TryOutPanel) | FAIL (A11Y-50, 52) |
| 4.58:1 | 3 | focus ring indigo-500 on white | pass |
| 4.63:1 | 4.5 | hint gray-500 on gray-50 | pass (tight) |
| 4.84:1 | 4.5 | hint gray-500 on white | pass |
| 5.78:1 | 4.5 | indigo-600 on indigo-50 (Customize hover) | pass |
| 6.37:1 | 4.5 | badge yellow-800 on yellow-100 | pass |
| 6.42:1 | 4.5 | error red-700 on white | pass |
| 6.46:1 | 4.5 / 3 | indigo-600 on white, white on indigo-600, focus ring | pass |
| 6.49:1 | 4.5 | badge green-800 on green-100 | pass |
| 6.81 to 8.82:1 | 4.5 | remaining alerts, badges, links, buttons (see test output) | pass |
| 9.86 to 17.75:1 | 4.5 | gray-700/800/900 text | pass |

All text pairs meet AA; the only failures are control borders (1.4.11). A grey border that reaches 3:1 does not exist between gray-400 (2.60:1) and gray-500 (4.84:1) in the default palette, so 10-02 uses `gray-500` and removes the `knownFailing` flags. Disabled controls (white or gray-400 on gray-100) are exempt from 1.4.3 and not listed. Card and panel borders are decorative and exempt.

## 5. Pending human (cannot be verified in jsdom)

| ID | Check | Why |
|----|-------|-----|
| A11Y-H1 | Screen reader pass (NVDA + Firefox, VoiceOver + Safari): search count announcement, filter-change announcement, pagination announcement, try-it-out progress log, menu note. | Announcement quality and timing depend on the AT. |
| A11Y-H2 | Focus ring visibility on every background (white, gray-50, gray-100 header, indigo buttons, dark badges), including the skip link when focused. | Visual judgement. |
| A11Y-H3 | Zoom 200% and 400% / 320 px reflow (1.4.4, 1.4.10): no clipped or overlapping content on catalog, detail and login. | Needs a real layout engine. |
| A11Y-H4 | `prefers-reduced-motion` and forced-colors / Windows high contrast. | Needs the OS setting. |
| A11Y-H5 | Real-browser colour contrast with `axe` DevTools on the rendered pages (jsdom skips colour rules). | No layout in jsdom. |
| A11Y-H6 | Keyboard-only walkthrough of the full flow: skip link, search, filters, pagination, card, detail, Customize menu, try-it-out. | End-to-end ergonomics. |

## 6. Scope exclusions

Dark mode (UI-02), the raw spec viewer (UI-04), the legacy TryOutPanel (unused), language-of-parts (Finnish content), captions or media (none), and server-rendered email content.

## 7. Resolution (plan 10-02)

| IDs | Resolution | Where |
|-----|------------|-------|
| A11Y-01, 02, 03 | fixed: skip link, `main#main-content tabindex=-1`, `<nav aria-label="Primary">` | src/routes/+layout.svelte |
| A11Y-04, 15, 22, 26, 33, 54, 58 | fixed: global `:focus-visible` indigo-600 outline in `@layer base`, plus explicit rings on Clear filters and summary | src/app.css, FilterBar, TechAccordion |
| A11Y-05 | fixed: catalog title | catalog/+page.svelte |
| A11Y-06 | fixed: card titles `<h2>` | AgentCard.svelte |
| A11Y-07, 08 | fixed: SearchBar's persistent `aria-live` region is the single announcer; new `message` prop carries the degraded notice; visual notice lost its `role="status"` (existing WR-07 test updated) | SearchBar, catalog/+page.svelte, catalog/page.test.ts |
| A11Y-10 | fixed: input refocused after Clear search | SearchBar |
| A11Y-11, 14, 19, 45, 50, 52 | fixed: control borders `gray-500` (4.84:1); `knownFailing` flags removed and a gray-500 pair is enforced | all inputs, selects, pagination buttons, login, legacy TryOutPanel |
| A11Y-13 | fixed: focus moves to the Category select after Clear filters | FilterBar |
| A11Y-16 | fixed: `role="group" aria-label="Filter agents"`, `type="button"` | FilterBar |
| A11Y-17, 18 | fixed: `keepFocus`, awaited `goto`, focus handed to the opposite button when the pressed one becomes disabled, `aria-label` "Previous page"/"Next page", indicator `aria-current` and `aria-live` | Pagination |
| A11Y-20, 21, 23, 24 | fixed: "View details: X", 44px target, "(opens in new tab)" name suffix on the external Try out link, `motion-reduce:transition-none` | AgentCard |
| A11Y-26, 27, 28 | fixed: arrows `aria-hidden`, sr-only new-tab text, `aria-controls="try-it-out-panel"` | agents/[slug]/+page.svelte |
| A11Y-30, 36 | fixed: both asides named via `aria-labelledby` | CustomizationPanel, TryItOutPanel |
| A11Y-35 | fixed: system prompt `<pre>` is a focusable labelled region | TechAccordion |
| A11Y-42, 43, 44, 46 | fixed: `role="log"` feed with label and `tabindex=0`, persistent sr-only `role="status"` job-state text, failure block `role="alert"` | TryItOutPanel |
| A11Y-51, 53 | fixed: login inputs `focus-visible:ring-blue-700`, error id referenced by `aria-describedby` | login/+page.svelte |
| A11Y-09, 12, 25, 29, 31, 32, 34, 37 to 41, 47 to 49, 55 to 57, 59, 60 | verified OK, no change | |
| A11Y-H1 to H6 | pending human, see 10-HUMAN-UAT.md | |
