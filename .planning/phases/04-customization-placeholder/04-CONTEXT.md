# Phase 4: Customization Placeholder - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning
**Mode:** Auto (unattended overnight run)

<domain>
## Phase Boundary
A visible "Customize" button on every agent detail page opens a menu listing available customization options (e.g. from the existing tailorable-fields config / CustomizationPanel built in Phase 2 plan 02-03). Items are clearly labeled; activating them shows a "coming soon" / disabled state, never an error. Requirement CUST-01.
</domain>

<decisions>
## Implementation Decisions
- Reuse the existing CustomizationPanel / tailorable-fields config and UI-SPEC (.planning/phases/02-catalog-and-detail/02-UI-SPEC.md) conventions; inspect the detail page code first and extend rather than duplicate.
- Menu: accessible disclosure/menu pattern, keyboard operable (Esc closes, arrow/Tab navigation, aria-haspopup/expanded), no new deps. Items use aria-disabled and a visible "Coming soon" badge; click/Enter on an item shows an inline "coming soon" note (no navigation, no error).
- Placeholder items: "Configure fields" (tailorable fields), "Connect your data" (future MCP wizard, link to nothing), "Change model" - labeled generically; all disabled. Do NOT implement Phase 14's wizard here.
- Component tests with @testing-library/svelte.
- Also: Phase 2's only remaining item is human checkpoint 02-04: mark as "pending human" in ROADMAP/REQUIREMENTS/STATE wording only; do not fake it.

### Claude's Discretion
All else.
</decisions>
<code_context>Gathered in planning.</code_context>
<specifics>None.</specifics>
<deferred>None.</deferred>
