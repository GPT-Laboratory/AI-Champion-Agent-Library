// src/lib/server/tryItOutModel.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.

// D-07: ONE fixed model + fixed low temperature for ALL runnable demo agents.
// Per-agent LLM config from the agent YAML is intentionally NOT read here —
// see CONTEXT.md D-07 ("generality this demo doesn't need"). This file does
// not read the provider's secret credential env var; the SDK client is
// constructed separately in tryItOutRunner.ts.
//
// Probed live 2026-08-19 against the deployed provider credential via
// `npx tsx --env-file=.env scripts/probe-openai-model.ts` — see
// .planning/phases/07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou/MODEL-PROBE.md
// for the verbatim captured output. `gpt-4.1-mini` was present in the real
// `client.models.list()` response for this key, and a real
// `client.responses.create({ model: 'gpt-4.1-mini', temperature: 0.2, ... })`
// call succeeded (TEMPERATURE_ACCEPTED) — so D-07's "fixed low temperature"
// requirement is met exactly here, not best-effort.
export const MODEL = 'gpt-4.1-mini'

/** The fixed low temperature (D-07), or null when the chosen model rejects a custom temperature. */
export const TEMPERATURE: number | null = 0.2

/**
 * Spread into client.responses.create({ model: MODEL, ...modelParams(), input }).
 * Returns {} when TEMPERATURE is null so the parameter is never sent (RESEARCH.md Pitfall 1).
 */
export function modelParams(): { temperature?: number } {
  return TEMPERATURE === null ? {} : { temperature: TEMPERATURE }
}
