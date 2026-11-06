// Shared unrecognized-outcome builder (kept apart from registry.ts to avoid an import cycle
// with the adapter modules).
import type { ParseOutcome } from './kinds.js'

export const UNRECOGNIZED_MISSING =
  'recognizable agent definition (Oracle AgentSpec YAML, catalog.yaml, SKILL.md, ...)'

export function unrecognizedOutcome(warnings: string[] = []): ParseOutcome {
  return {
    status: 'missing-from-author',
    format: 'unknown',
    record: null,
    kindInfo: null,
    missingFromAuthor: [UNRECOGNIZED_MISSING],
    unknownFields: [],
    warnings,
  }
}
