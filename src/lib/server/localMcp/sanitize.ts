import { MAX_RESPONSE_BYTES, type McpToolResult } from './types'

const MAX_STRING = 500
const MAX_ITEMS = 50
const MAX_DEPTH = 6
const MAX_PARSE_CHARS = 1_000_000
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function clean(s: string): string {
  const t = s.replace(CONTROL, '')
  return t.length > MAX_STRING ? t.slice(0, MAX_STRING) : t
}

function shape(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return clean(v)
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v
  if (depth >= MAX_DEPTH) return '[depth limit]'
  if (Array.isArray(v)) return v.slice(0, MAX_ITEMS).map((x) => shape(x, depth + 1))
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (BAD_KEYS.has(k)) continue
      out[clean(k)] = shape(x, depth + 1)
    }
    return out
  }
  return null
}

function extract(result: McpToolResult): unknown {
  if (result.structuredContent !== undefined && result.structuredContent !== null) return result.structuredContent
  const block = (result.content ?? []).find((c) => c && c.type === 'text' && typeof c.text === 'string')
  const t = block?.text ?? ''
  if (t.length <= MAX_PARSE_CHARS) {
    try {
      const j: unknown = JSON.parse(t)
      if (j !== null && typeof j === 'object') return j
    } catch {
      /* plain text */
    }
  }
  return t
}

/** Caps and cleans an upstream result. Hostile text is data: only length and control characters change. */
export function shapeResult(result: McpToolResult): { data: unknown; truncated: boolean; isError: boolean } {
  const data = shape(extract(result), 0)
  const isError = result.isError === true
  if (Buffer.byteLength(JSON.stringify(data) ?? '', 'utf8') <= MAX_RESPONSE_BYTES) {
    return { data, truncated: false, isError }
  }
  const keys = data !== null && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).slice(0, 20) : []
  return { data: { note: 'response too large, narrow the query', keys }, truncated: true, isError }
}
