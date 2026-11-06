# Phase 5: Try It Out Field - Context

**Gathered:** 2026-08-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Add an optional `try_it_out` field to agent records and surface it on the agent detail page as a link or disabled button, depending on mode. No runtime execution of any kind is built in this phase — `runnable` mode only reserves the UI affordance for a future phase.

</domain>

<decisions>
## Implementation Decisions

### Field shape
- **D-01:** `try_it_out` has a `mode` of `none | external | runnable`.
- **D-02:** `url` is required when `mode: external` (used as the link target). Not applicable to `none` or `runnable`.
- **D-03:** `task_template` is optional, applies to `external`/`runnable` modes only — free-form text/string, no schema beyond "optional string."

### Files in scope (locked)
- **D-04:** Only three files/areas change: `drizzle/schema.ts`, `scripts/ingest.ts`, and the agent detail page (`src/routes/agents/[slug]/+page.svelte`, plus `+page.server.ts` only if the existing `db.select()` needs no change — verify it doesn't, since it already selects all columns).
- **D-05:** Do NOT modify `src/lib/spec/types.ts` (`AgentRecord`), `src/lib/spec/oracle-agentspec.ts`, or `src/lib/spec/index.ts` (the adapter/normalize pipeline). `try_it_out` is not sourced from Oracle AgentSpec YAML in this phase — it is independent of the ingest source data.
- **D-06:** `scripts/ingest.ts`'s `flattenRecord()` takes an `AgentRecord` as input (per D-05, unchanged) — it cannot read `try_it_out` from the parsed record. It must write a safe default (`mode: 'none'`, null url, null task_template) for every row it inserts, sourced from the schema column defaults, not from `AgentRecord`.
- **D-07:** The `onConflictDoUpdate` `set` clause in `scripts/ingest.ts` must NOT include the `try_it_out` columns. This is intentional: it means re-running ingestion (`npm run ingest` or equivalent) never overwrites a manually-set `try_it_out` value on an existing row. Every other column keeps updating on conflict as it does today.

### Storage shape (Drizzle schema)
- **D-08:** Store as flat nullable columns on the `agents` table, matching the existing `llm_*` convention (e.g. `try_it_out_mode` text with default `'none'`, `try_it_out_url` text nullable, `try_it_out_task_template` text nullable) — NOT a JSON blob. This matches how `llmTemperature`/`llmMaxTokens`/`llmTopP` are modeled as separate flat columns rather than a nested object, and keeps the "no build changes" constraint trivial (no migration tooling beyond the existing schema file).

### Detail page rendering (per mode)
- **D-09:** `mode: none` or missing/null → render nothing (no button, no link, no placeholder).
- **D-10:** `mode: external` → render a "Try it out" link that opens `url` (use the same link pattern as the existing GitHub link: `target="_blank" rel="noopener noreferrer"`).
- **D-11:** `mode: runnable` → render a disabled "Try it out" button (visually present, non-interactive — `disabled` attribute, no click handler, no runtime wiring of any kind).
- **D-12:** Place the Try It Out affordance in the same executive-summary area as the existing GitHub link (left column, near the top), not inside `TechAccordion` or `CustomizationPanel` — it's a primary action, not a technical detail or customization option.

### Setting the example agent
- **D-13:** Set `rfi-triage-assistant` (`data/agents/rfi-triage-assistant.yaml`'s corresponding DB row, slug `rfi-triage-assistant`) to `mode: external` with a placeholder `url` (e.g. `https://example.com/try/rfi-triage-assistant`) via a direct one-off `UPDATE agents SET ... WHERE slug = 'rfi-triage-assistant'` against the dev DB (`db/catalog.db`) — NOT by editing the YAML source file (that would require touching the AgentRecord/adapter pipeline, which is out of scope per D-05). This is a one-time manual/scripted DB update, not a new permanent file.

### Claude's Discretion
- Exact placeholder URL string (any clearly-fake, non-functional URL is fine).
- Exact Tailwind styling for the disabled `runnable` button (should look visually distinct from the enabled `external` link — e.g. muted/gray, `cursor-not-allowed`).
- Whether the one-off DB update is run via inline `sqlite3` CLI, a `better-sqlite3` one-liner, or Drizzle — as long as no new permanent script/file is added and it only touches the running dev DB.

</decisions>

<specifics>
## Specific Ideas

- "None/missing renders no button, external renders a 'Try it out' link that opens url, runnable renders a disabled 'Try it out' button for now."
- "Do not build any runtime" — `runnable` is purely a visual placeholder for a future phase; zero execution logic.

</specifics>

<canonical_refs>
## Canonical References

No external specs, ADRs, or design docs govern this phase — requirements are fully captured in the decisions above (this phase was scoped directly by the user, not via `/gsd-discuss-phase`).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `drizzle/schema.ts` — `agents` table already models optional/nullable fields flatly (`category`, `githubUrl`, `llmTemperature`, etc.) and JSON-string array fields (`toolNames`, `tags`) via `text(...).notNull().default('[]')`. Follow the flat-nullable-column pattern (D-08), not the JSON-string pattern — this isn't an array.
- `src/routes/agents/[slug]/+page.svelte` lines 50-59 — existing conditional external link pattern to mirror for the `external` mode link:
  ```svelte
  {#if agent.githubUrl}
    <a href={agent.githubUrl} target="_blank" rel="noopener noreferrer" class="...">
      View on GitHub &rarr;
    </a>
  {/if}
  ```

### Established Patterns
- `src/routes/agents/[slug]/+page.server.ts` does `db.select().from(agents)...` (selects all columns) — new schema columns flow through to `agent` in the page automatically. No server-load change needed unless JSON-parsing is required (not needed here since D-08 uses flat scalar columns, not JSON).
- `scripts/ingest.ts`'s `flattenRecord()` maps `AgentRecord` → `NewAgentRow` field-by-field, and the `onConflictDoUpdate` `set` block explicitly lists every column that should be overwritten on re-ingest. D-06/D-07 depend on this structure: add the three new columns to the inserted row (with defaults) but deliberately omit them from the `set` block.

### Integration Points
- `agents` Drizzle table (`drizzle/schema.ts`) is the single integration point between ingest and the detail page — both already consume it directly (`NewAgentRow`/`AgentRow` types, `db.select()`).

</code_context>

<deferred>
## Deferred Ideas

- Any actual `runnable` execution/runtime — explicitly out of scope for this phase and not scheduled elsewhere yet; will need its own future phase.
- Surfacing `try_it_out` on the catalog browse page (Phase 2) or in search (Phase 3) — not requested; this phase only touches the detail page.

</deferred>

---

*Phase: 05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape*
*Context gathered: 2026-08-18*
