// Adapter registry: size cap, credential scan, detect, parse. Never throws.
import type { Gap, GenerateOptions, InputAdapter, ParseResult, RawInput, SourceModel } from './types.js'
import { ADAPTERS } from './adapters/index.js'
import { MAX_INPUT_BYTES } from './api-contract.js'
import { scanForCredentials, toGaps } from './credentials.js'
import { stripSqlDumpData } from './sqlcopy.js'

export type ParseInputResult =
  | { ok: true; model: SourceModel; adapterId: string; gaps: Gap[] }
  | { ok: false; gaps: Gap[] }

const err = (code: string, message: string): Gap => ({ code, message, severity: 'error' })

export function listAdapters(): InputAdapter[] {
  return ADAPTERS.slice()
}

/** Adapters that detect, best first (confidence desc, then list order). */
export function detectAdapters(
  raw: RawInput,
  adapters: InputAdapter[] = ADAPTERS,
): Array<{ adapter: InputAdapter; confidence: number }> {
  const hits: Array<{ adapter: InputAdapter; confidence: number; order: number }> = []
  adapters.forEach((adapter, order) => {
    try {
      const confidence = adapter.detect(raw)
      if (typeof confidence === 'number' && confidence > 0) hits.push({ adapter, confidence, order })
    } catch {
      /* a failing detector is a non-detect */
    }
  })
  hits.sort((a, b) => b.confidence - a.confidence || a.order - b.order)
  return hits.map(({ adapter, confidence }) => ({ adapter, confidence }))
}

/**
 * Async preparation for adapters that load a parser on demand (the OData adapter's XML reader, D-560). Call it, and await it,
 * before `parseInput` / `runPipeline`; it picks the same adapter `parseInput` will pick and never throws.
 */
export async function prepareInput(raw: RawInput, opts: { adapterId?: string; adapters?: InputAdapter[] } = {}): Promise<void> {
  try {
    const adapters = opts.adapters ?? ADAPTERS
    const text = typeof raw?.text === 'string' ? raw.text : ''
    if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) return
    const input: RawInput = { ...raw, text }
    const adapter = opts.adapterId !== undefined ? adapters.find((a) => a.id === opts.adapterId) : detectAdapters(input, adapters)[0]?.adapter
    await adapter?.prepare?.(input)
  } catch {
    /* parse reports what is missing */
  }
}

/** The source text without parts that must not leave the process (SQL row data); other adapters return it unchanged. */
export function scrubSource(adapterId: string, text: string, adapters: InputAdapter[] = ADAPTERS): { text: string; changed: boolean } {
  try {
    const f = adapters.find((a) => a.id === adapterId)?.scrubSource
    return f ? f(text) : { text, changed: false }
  } catch {
    return { text: '', changed: true } // fail closed: nothing of the source leaves
  }
}

export function parseInput(
  raw: RawInput,
  opts: { adapterId?: string; adapters?: InputAdapter[]; options?: GenerateOptions } = {},
): ParseInputResult {
  try {
    const adapters = opts.adapters ?? ADAPTERS
    const text = typeof raw?.text === 'string' ? raw.text : ''
    if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) {
      return {
        ok: false,
        gaps: [err('input-too-large', `Input exceeds the ${MAX_INPUT_BYTES} byte limit.`)],
      }
    }
    // SQL dump row data (COPY ... FROM stdin blocks) is never ingested, so the scan sees only the
    // text the sql-ddl adapter reads. Applies only when that adapter is the one that will parse it.
    let scanText = text
    let sqlDumpAdapter: InputAdapter | undefined
    const stripped = stripSqlDumpData(text)
    if (stripped.changed) {
      const sql = adapters.find((a) => a.id === 'sql-ddl')
      if (sql && (opts.adapterId === 'sql-ddl' || (opts.adapterId === undefined && detectAdapters({ ...raw, text: stripped.text }, adapters)[0]?.adapter === sql))) {
        scanText = stripped.text
        sqlDumpAdapter = sql
      }
    }
    const findings = scanForCredentials(scanText)
    if (findings.length > 0) return { ok: false, gaps: toGaps(findings) }

    const input: RawInput = { ...raw, text }
    let adapter: InputAdapter | undefined
    if (sqlDumpAdapter) {
      adapter = sqlDumpAdapter
    } else if (opts.adapterId !== undefined) {
      adapter = adapters.find((a) => a.id === opts.adapterId)
      if (!adapter) {
        return { ok: false, gaps: [err('unknown-adapter', 'No adapter with that id is registered.')] }
      }
    } else {
      adapter = detectAdapters(input, adapters)[0]?.adapter
      if (!adapter) {
        return {
          ok: false,
          gaps: [err('unrecognized-input', 'The input format was not recognized by any adapter. If the document is OpenAPI, Swagger, OData, SQL or Prisma, name the adapter explicitly (adapter option or --adapter).')],
        }
      }
    }
    let result: ParseResult
    try {
      result = adapter.parse(input, opts.options)
    } catch {
      return { ok: false, gaps: [err('adapter-failed', `Adapter ${adapter.id} failed to parse the input.`)] }
    }
    if ('rejected' in result) return { ok: false, gaps: result.rejected }
    return { ok: true, model: result.model, adapterId: adapter.id, gaps: result.gaps }
  } catch {
    return { ok: false, gaps: [err('adapter-failed', 'Unexpected error while parsing the input.')] }
  }
}
