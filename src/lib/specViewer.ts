// UI-04 raw spec viewer helpers (flag UI_SPEC_VIEWER). Pure: no fs, no db, no network.
import { stringify } from 'yaml'
import { redactSecrets, capText } from '$lib/spec/security.js'

export const SPEC_VIEWER_MAX_BYTES = 32768

export interface SpecRowLike {
  slug: string
  title: string
  summary: string
  systemPrompt: string
  llmName: string
  llmTemperature: number | null
  llmMaxTokens: number | null
  llmTopP: number | null
  toolNames: string[]
  inputFields: unknown
  requiresHumanApproval: boolean
  category: string | null
  githubUrl: string | null
  maturityStatus: string
  tags: string[]
  customizableFields: string[] | null
  fixedFields: string[]
  fixedNote: string | null
  specId: string | null
}

/**
 * The original YAML is not stored by ingest, so the viewer shows the stored canonical record
 * re-serialised as YAML (try-it-out settings are operator config, not spec, and are omitted).
 * Redacted first, then size-capped.
 */
export function buildSpecText(row: SpecRowLike): { text: string; truncated: boolean } {
  const record = redactSecrets({
    slug: row.slug,
    specId: row.specId,
    title: row.title,
    summary: row.summary,
    category: row.category,
    maturityStatus: row.maturityStatus,
    tags: row.tags,
    githubUrl: row.githubUrl,
    llm: {
      name: row.llmName,
      temperature: row.llmTemperature,
      maxTokens: row.llmMaxTokens,
      topP: row.llmTopP,
    },
    systemPrompt: row.systemPrompt,
    toolNames: row.toolNames,
    requiresHumanApproval: row.requiresHumanApproval,
    inputFields: row.inputFields,
    customizableFields: row.customizableFields,
    fixedFields: row.fixedFields,
    fixedNote: row.fixedNote,
  })
  let yaml: string
  try {
    yaml = stringify(record, { lineWidth: 0 })
  } catch {
    yaml = '# spec unavailable\n'
  }
  return capText(yaml, SPEC_VIEWER_MAX_BYTES)
}

export type SpecTokenKind = 'key' | 'string' | 'number' | 'bool' | 'null' | 'comment' | 'punct' | 'text'
export interface SpecToken {
  kind: SpecTokenKind
  text: string
}

function scalarKind(v: string): SpecTokenKind {
  const t = v.trim()
  if (t === '') return 'text'
  if (/^(true|false)$/i.test(t)) return 'bool'
  if (/^(null|~)$/i.test(t)) return 'null'
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(t)) return 'number'
  return 'string'
}

/** Tokenise one YAML line. Concatenating token texts always reproduces the line exactly. */
export function tokenizeLine(line: string): SpecToken[] {
  const out: SpecToken[] = []
  const indent = /^\s*/.exec(line)![0]
  let rest = line.slice(indent.length)
  if (indent) out.push({ kind: 'text', text: indent })
  if (rest.startsWith('#')) return [...out, { kind: 'comment', text: rest }]
  while (rest.startsWith('- ') || rest === '-') {
    const dash = rest.startsWith('- ') ? '- ' : '-'
    out.push({ kind: 'punct', text: dash })
    rest = rest.slice(dash.length)
  }
  const m = /^([A-Za-z0-9_.-]+):(?=\s|$)/.exec(rest)
  if (m) {
    out.push({ kind: 'key', text: m[1]! }, { kind: 'punct', text: ':' })
    rest = rest.slice(m[0].length)
  }
  if (rest) {
    const lead = /^\s*/.exec(rest)![0]
    if (lead) out.push({ kind: 'text', text: lead })
    const val = rest.slice(lead.length)
    if (val) out.push({ kind: /^[|>][-+]?$/.test(val) ? 'punct' : scalarKind(val), text: val })
  }
  return out
}

export function tokenizeSpec(text: string): SpecToken[][] {
  return text.replace(/\n$/, '').split('\n').map(tokenizeLine)
}
