# Phase 10: Accessibility (UI-03) - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning
**Mode:** Auto (unattended overnight run)

<domain>
## Phase Boundary
Catalog, search and detail pages (incl. SearchBar, FilterBar, Pagination, AgentCard, TechAccordion, CustomizationPanel, CustomizeMenu, Try-it-out panel) meet WCAG AA basics: keyboard operability with visible focus, labelled controls, focus management, contrast, live-region announcements. Requirement UI-03.
</domain>

<decisions>
## Implementation Decisions
- Audit first (10-AUDIT.md: per component/page, findings with severity), then fix, then tests.
- axe: use `axe-core` only if it can run in jsdom with the existing vitest setup; it is a devDependency addition and must be logged as a D-NNN with revert (alternatives: hand-written role/name assertions only). Prefer adding it (dev-only) — rule scope limited (color-contrast disabled in jsdom).
- Contrast: compute contrast ratios of the Tailwind palette tokens used (script/test with a tiny WCAG formula, no deps); fix failing tokens minimally without changing the visual design beyond what's needed; items needing visual judgement go to 10-HUMAN-UAT.md.
- Skip link, landmark roles (main/nav/search), heading order, focus-visible styles, focus restore after navigation/menus, aria-live for result count/no-results already partly done in Phase 3 — verify, don't duplicate.
- No behaviour changes beyond a11y. Dark mode (UI-02) is out of scope here (later backlog item).

### Claude's Discretion
All else.
</decisions>
<code_context>Gathered in planning.</code_context>
<specifics>None.</specifics>
<deferred>None.</deferred>
