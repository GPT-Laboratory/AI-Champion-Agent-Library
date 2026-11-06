// Pure helpers for the MCP test panel (Phase 15, flag MCP_TESTER). Client-safe: no server or DOM imports.
import type { FidelityEntry } from './core/fidelity.js'

export type CaseBadge = 'implemented' | 'synthetic' | 'generator-only' | 'needs real runtime'

export interface CaseInfo {
  id: string
  tier: number
  title: string
  badge: CaseBadge
}

export interface SubjectInfo {
  id: string
  kind: string
  label: string
  runnable: boolean
  note?: string
}

export const CELL_STATE_VALUES = [
  'PASS',
  'FAIL',
  'NA_MODALITY',
  'NA_TRANSPORT',
  'SKIPPED_FIXTURE',
  'UNAVAILABLE',
  'INSTALL_FAILED',
  'GEN_FAILED',
  'ERROR',
  'PENDING_HUMAN'
] as const

const STATE_LABELS: Record<(typeof CELL_STATE_VALUES)[number], string> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  NA_MODALITY: 'N/A (input kind)',
  NA_TRANSPORT: 'N/A (transport)',
  SKIPPED_FIXTURE: 'Skipped (no fixture)',
  UNAVAILABLE: 'Unavailable',
  INSTALL_FAILED: 'Install failed',
  GEN_FAILED: 'Generation failed',
  ERROR: 'Error',
  PENDING_HUMAN: 'Pending human'
}

export function stateLabel(state: string): string {
  return (STATE_LABELS as Record<string, string>)[state] ?? 'Unknown'
}

/** Colour classes per state; the label text always carries the meaning, colour is only a second cue. */
export function stateClass(state: string): string {
  switch (state) {
    case 'PASS':
      return 'bg-green-100 text-green-900 border-green-700'
    case 'FAIL':
    case 'ERROR':
    case 'GEN_FAILED':
    case 'INSTALL_FAILED':
      return 'bg-red-100 text-red-900 border-red-700'
    case 'PENDING_HUMAN':
    case 'UNAVAILABLE':
      return 'bg-yellow-100 text-yellow-900 border-yellow-700'
    default:
      return 'bg-gray-100 text-gray-800 border-gray-500'
  }
}

/** Badge from the fidelity table: where S-real needs a real runtime, G is generator-only, minimal is synthetic. */
export function caseBadge(e: Pick<FidelityEntry, 'where' | 'platformStatus'>): CaseBadge {
  if (e.where === 'S-real') return 'needs real runtime'
  if (e.where === 'G') return 'generator-only'
  if (e.platformStatus !== 'implemented') return 'synthetic'
  return 'implemented'
}

export function groupByTier<T extends { tier: number }>(cases: T[]): { tier: number; cases: T[] }[] {
  return [1, 2, 3, 4].map((tier) => ({ tier, cases: cases.filter((c) => c.tier === tier) }))
}

/** Blockers first; otherwise original order is kept (stable). */
export function flagsBlockersFirst<T extends { severity: string }>(flags: T[]): T[] {
  return [...flags.filter((f) => f.severity === 'blocker'), ...flags.filter((f) => f.severity !== 'blocker')]
}
