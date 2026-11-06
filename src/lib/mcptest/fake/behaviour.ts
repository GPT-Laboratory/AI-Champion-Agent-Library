// Behaviour knobs for the fake MCP server (Phase 15 scorer fixtures).
// The good variant is GOOD; flawed variants override a subset (see variants.ts).
// Imports nothing from $lib, svelte or @sveltejs.

export type ProcessFault = 'crash-on-init' | 'hang' | 'stdout-noise' | 'old-protocol' | 'unknown-protocol'

export interface Behaviour {
  /** 1:1 endpoint tools only, raw payload, no clamp, no derived tool, leaky errors. */
  mirror: boolean
  /** Expose find_items_by_attribute (client-side filter over pages). */
  derivedTool: boolean
  /** Cap top-level fields at 12 (id, code, name, category, supplier, attributes + selected scalars). */
  projection: boolean
  /** Clamp per_page to the documented max (50) and say so. */
  clamp: boolean
  errorStyle: 'clean' | 'leaky' | 'bare-empty' | 'no-auth-message'
  /** Retry 429/5xx and connection resets up to 3 attempts; honour Retry-After; injectable sleep. */
  retry: boolean
  malformed: 'honest' | 'fabricate'
  /** Adds delete_item (non-GET upstream attempt). */
  writeTool: boolean
  /** Includes the API key value in a tool output and on stderr. */
  echoSecret: boolean
  /** false = also calls an undocumented route. */
  grounded: boolean
  /** false = forwards an invalid GTIN to the upstream. */
  validateCodes: boolean
  largeResponse: 'bounded' | 'huge' | 'silent-cap'
  processFault?: ProcessFault
}

export const GOOD: Behaviour = {
  mirror: false,
  derivedTool: true,
  projection: true,
  clamp: true,
  errorStyle: 'clean',
  retry: true,
  malformed: 'honest',
  writeTool: false,
  echoSecret: false,
  grounded: true,
  validateCodes: true,
  largeResponse: 'bounded'
}

export const PROJECTION_MAX_FIELDS = 12
export const MAX_PAGE_SIZE = 50
