// Try It Out run harness: submit a job to a running app, poll, download the artifact,
// read token usage and append the run to the spend ledger (.planning/spend-log.md).
//
// Usage: npx tsx scripts/tryout-run.ts --plan 25-01 --agent demo-rfi-triage --task "..." \
//          --file path/to/input.txt --label synthetic [--base-url http://127.0.0.1:3000]
// Exit codes: 0 ok, 1 job failed, 2 usage error, 3 budget refusal, 4 timeout, 5 HTTP/transport error.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { isMainModule } from './is-main.js'

// Price assumption for gpt-4.1-mini: USD 0.40 / 1M input, 1.60 / 1M output tokens. The proxy only
// reports total tokens, so ALL tokens are priced at the output rate (conservative upper bound).
// The OpenAI dashboard is ground truth.
export const PRICE_OUTPUT_PER_MTOK = 1.6
export const RESERVE_USD = 0.5
export const CAP_USD = 10
const MAX_ARTIFACT_FILE_BYTES = 10_000_000
const MAX_ARTIFACT_BYTES = 20_000_000

export interface Opts {
  agent: string
  task: string
  label: 'public' | 'synthetic'
  plan: string
  file?: string
  baseUrl: string
  origin: string
  ledger: string
  outDir: string
  timeoutS: number
  pollMs: number
  pricePerMtok: number
}

export class UsageError extends Error {}

export function parseArgs(argv: string[]): Opts {
  const m = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) throw new UsageError(`unexpected argument: ${a}`)
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) throw new UsageError(`missing value for ${a}`)
    m.set(a.slice(2), v)
    i++
  }
  for (const req of ['agent', 'task', 'label']) {
    if (!m.get(req)) throw new UsageError(`--${req} is required`)
  }
  const label = m.get('label')
  if (label !== 'public' && label !== 'synthetic') throw new UsageError('--label must be public or synthetic')
  const baseUrl = (m.get('base-url') ?? 'http://127.0.0.1:3000').replace(/\/+$/, '')
  const num = (k: string, d: number) => {
    const raw = m.get(k)
    if (raw === undefined) return d
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) throw new UsageError(`--${k} must be a positive number`)
    return n
  }
  return {
    agent: m.get('agent')!,
    task: m.get('task')!,
    label,
    plan: m.get('plan') ?? '',
    file: m.get('file'),
    baseUrl,
    origin: m.get('origin') ?? new URL(baseUrl).origin,
    ledger: m.get('ledger') ?? '.planning/spend-log.md',
    outDir: m.get('out-dir') ?? '.tryitout-runs',
    timeoutS: num('timeout-s', 400),
    pollMs: num('poll-ms', 2000),
    pricePerMtok: num('price-per-mtok', PRICE_OUTPUT_PER_MTOK),
  }
}

// ---- ledger -------------------------------------------------------------------------------

const HEADER = `# Spend log (real-model Try It Out runs)
Cap: 10.00 USD total for the autonomous run; the harness refuses to start when total + 0.50 would exceed it. Costs are an upper-bound estimate (all tokens priced at the output rate); the OpenAI dashboard is ground truth.

| run_id | date | plan | agent | job_id | model | total_tokens | requests | cost_usd | status | note |
|---|---|---|---|---|---|---|---|---|---|---|
`

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}

export function readLedgerTotal(path: string): number {
  if (!existsSync(path)) return 0
  const lines = readFileSync(path, 'utf8').split('\n')
  let idx = -1
  let total = 0
  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue
    const c = cells(line)
    if (idx < 0) {
      idx = c.indexOf('cost_usd')
      continue
    }
    if (c.every((x) => /^:?-+:?$/.test(x))) continue
    const n = Number(c[idx])
    if (Number.isFinite(n) && c[idx] !== '') total += n
  }
  return Math.round(total * 10000) / 10000
}

export function guardBudget(total: number, reserve = RESERVE_USD, cap = CAP_USD): boolean {
  // true = allowed. Compare in cents to avoid float noise (9.50 + 0.50 must be allowed).
  return Math.round((total + reserve) * 100) <= Math.round(cap * 100)
}

export function estimateCostUsd(totalTokens: number, pricePerMtok = PRICE_OUTPUT_PER_MTOK): number {
  return Math.round((totalTokens / 1e6) * pricePerMtok * 10000) / 10000
}

export interface LedgerRow {
  runId: string
  date: string
  plan: string
  agent: string
  jobId: string
  model: string
  totalTokens: string
  requests: string
  costUsd: number
  status: string
  note: string
}

function formatRow(r: LedgerRow): string {
  const esc = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ')
  return (
    '| ' +
    [r.runId, r.date, r.plan, r.agent, r.jobId, r.model, r.totalTokens, r.requests, r.costUsd.toFixed(4), r.status, r.note]
      .map(esc)
      .join(' | ') +
    ' |'
  )
}

/**
 * Runs `fn` while holding `<ledger>.lock` (created with O_EXCL), so two harness runs cannot interleave their
 * read-modify-write of the ledger (CR-52c). A lock older than 30 s is taken over (a crashed run). Synchronous.
 */
export function withLedgerLock<T>(path: string, fn: () => T): T {
  const lock = `${path}.lock`
  mkdirSync(dirname(path), { recursive: true })
  const wait = new Int32Array(new SharedArrayBuffer(4))
  const until = Date.now() + 10_000
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'))
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30_000) unlinkSync(lock)
      } catch {
        /* released meanwhile */
      }
      if (Date.now() > until) throw new Error('ledger is locked by another run')
      Atomics.wait(wait, 0, 0, 25)
    }
  }
  try {
    return fn()
  } finally {
    try {
      unlinkSync(lock)
    } catch {
      /* already gone */
    }
  }
}

/** Insert or replace (matched on run_id) a ledger row under the ledger lock. */
export function writeLedgerRow(path: string, row: LedgerRow): void {
  withLedgerLock(path, () => writeLedgerRowUnlocked(path, row))
}

/** Atomic write via temp + rename; the caller holds the lock. */
function writeLedgerRowUnlocked(path: string, row: LedgerRow): void {
  let text = existsSync(path) ? readFileSync(path, 'utf8') : HEADER
  const lines = text.split('\n')
  const out: string[] = []
  let replaced = false
  for (const line of lines) {
    if (line.trim().startsWith('|') && cells(line)[0] === row.runId) {
      out.push(formatRow(row))
      replaced = true
    } else out.push(line)
  }
  if (!replaced) {
    while (out.length && out[out.length - 1] === '') out.pop()
    out.push(formatRow(row), '')
  }
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, out.join('\n'))
  renameSync(tmp, path)
}

// ---- run ----------------------------------------------------------------------------------

export interface Evidence {
  jobId: string | null
  status: string
  model: string
  totalTokens: number | string
  requests: number | string
  estCostUsd: number
  countable: boolean
  inputLabel: string
  outputFiles: string[]
  firstOutputLines: string[]
  durationS: number
  error?: string | null
  events?: number
}

export interface RunDeps {
  log?: (s: string) => void
  out?: (s: string) => void
}

/** True when the failure happened before any request could have reached a server. */
function neverSent(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause
  if (cause?.code === 'ECONNREFUSED' || cause?.code === 'ENOTFOUND' || cause?.code === 'EAI_AGAIN' || cause?.message === 'bad port') return true
  return err instanceof TypeError && /invalid url|failed to parse url/i.test(err.message)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runJob(opts: Opts, deps: RunDeps = {}): Promise<number> {
  const log = deps.log ?? ((s: string) => process.stderr.write(s + '\n'))
  const out = deps.out ?? ((s: string) => process.stdout.write(s + '\n'))

  // CR-52b: read the input before anything is reserved; a bad --file cannot have spent anything.
  let fileBytes: Buffer | undefined
  if (opts.file) {
    try {
      fileBytes = readFileSync(opts.file)
    } catch {
      log(`cannot read --file ${basename(opts.file)}; nothing was reserved`)
      return 2
    }
  }

  const start = Date.now()
  const date = new Date(start).toISOString()
  const runId = `${date}-${opts.agent}`
  const row: LedgerRow = {
    runId, date, plan: opts.plan, agent: opts.agent, jobId: '', model: 'unknown',
    totalTokens: 'unknown', requests: 'unknown', costUsd: RESERVE_USD, status: 'reserved', note: `label=${opts.label}`,
  }
  // Budget check and reservation are one step under the ledger lock (CR-52c).
  const refused = withLedgerLock(opts.ledger, () => {
    const total = readLedgerTotal(opts.ledger)
    if (!guardBudget(total)) return total
    writeLedgerRowUnlocked(opts.ledger, row)
    return null
  })
  if (refused !== null) {
    log(`REFUSED: ledger total ${refused.toFixed(2)} + ${RESERVE_USD.toFixed(2)} would exceed ${CAP_USD.toFixed(2)} USD`)
    return 3
  }

  const ev: Evidence = {
    jobId: null, status: 'unknown', model: 'unknown', totalTokens: 'unknown', requests: 'unknown',
    estCostUsd: RESERVE_USD, countable: false, inputLabel: opts.label, outputFiles: [], firstOutputLines: [], durationS: 0,
  }
  const deadline = start + opts.timeoutS * 1000
  // CR-52a: every request is bounded by the time left (at least 1 s, at most 60 s), so one stalled response cannot hang the run.
  const tfetch = (url: string, init: RequestInit = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(Math.min(60_000, Math.max(1000, deadline - Date.now()))) })
  const finish = (code: number, status: string, note: string): number => {
    ev.durationS = Math.round((Date.now() - start) / 100) / 10
    ev.status = status
    // A rejected submission (no job id) cannot have spent tokens: no reserve is kept.
    if (ev.jobId === null && status === 'http-error') ev.estCostUsd = 0
    writeLedgerRow(opts.ledger, {
      ...row, jobId: ev.jobId ?? '', model: ev.model, totalTokens: String(ev.totalTokens),
      requests: String(ev.requests), costUsd: ev.estCostUsd, status, note: `label=${opts.label}; ${note}`,
    })
    out(JSON.stringify(ev))
    return code
  }

  let cookie = ''
  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { Origin: opts.origin }
    if (cookie) h.Cookie = cookie
    return h
  }

  try {
    const form = new FormData()
    form.set('agentId', opts.agent)
    form.set('task', opts.task)
    if (opts.file && fileBytes) form.set('file', new Blob([new Uint8Array(fileBytes)]), basename(opts.file))
    const post = await tfetch(`${opts.baseUrl}/api/tryitout/jobs`, { method: 'POST', body: form, headers: headers() })
    const sc = post.headers.getSetCookie?.() ?? []
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ')
    if (!post.ok) {
      ev.error = `POST jobs -> HTTP ${post.status}`
      log(ev.error)
      return finish(5, 'http-error', ev.error)
    }
    const { jobId } = (await post.json()) as { jobId: string }
    // CR-53: the id becomes a URL segment and a directory name; accept only a plain token.
    if (typeof jobId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) {
      ev.error = 'server returned an invalid job id'
      log(ev.error)
      return finish(5, 'http-error', 'invalid job id')
    }
    ev.jobId = jobId
    log(`job ${jobId} queued`)

    let status = 'queued'
    let jobError: string | null = null
    let lastEvents = 0
    for (;;) {
      const r = await tfetch(`${opts.baseUrl}/api/tryitout/jobs/${jobId}`, { headers: headers() })
      if (!r.ok) {
        ev.error = `GET job -> HTTP ${r.status}`
        return finish(5, 'http-error', ev.error)
      }
      const j = (await r.json()) as { status: string; events?: unknown[]; error: string | null }
      status = j.status
      jobError = j.error
      lastEvents = j.events?.length ?? 0
      if (status === 'succeeded' || status === 'failed') break
      if (Date.now() >= deadline) return finish(4, 'timeout', 'timeout; reserve kept')
      await sleep(opts.pollMs)
    }
    ev.events = lastEvents
    log(`job ${status}`)

    // usage (works for failed jobs too)
    let observed = false
    try {
      const u = await tfetch(`${opts.baseUrl}/api/tryitout/jobs/${jobId}/usage`, { headers: headers() })
      if (u.ok) {
        const uj = (await u.json()) as { model: string; totalTokens: number; requests: number }
        ev.model = uj.model
        ev.totalTokens = uj.totalTokens
        ev.requests = uj.requests
        ev.estCostUsd = estimateCostUsd(uj.totalTokens, opts.pricePerMtok)
        observed = true
      }
    } catch {
      /* treated as unobserved */
    }

    if (status === 'failed') {
      ev.error = jobError
      log(`job failed: ${jobError}`)
      return finish(1, 'failed', observed ? `error: ${jobError}` : `usage-unknown; error: ${jobError}`)
    }

    const art = await tfetch(`${opts.baseUrl}/api/tryitout/jobs/${jobId}/artifact`, { headers: headers() })
    if (!art.ok) {
      ev.error = `GET artifact -> HTTP ${art.status}`
      return finish(5, 'http-error', ev.error)
    }
    // CR-53: a hostile server must not be able to expand a small zip into gigabytes.
    let declared = 0
    let tooBig = false
    const files = unzipSync(new Uint8Array(await art.arrayBuffer()), {
      filter: (f) => {
        declared += f.originalSize
        if (f.originalSize > MAX_ARTIFACT_FILE_BYTES || declared > MAX_ARTIFACT_BYTES) tooBig = true
        return !tooBig
      },
    })
    if (tooBig) {
      ev.error = 'artifact is larger than the harness accepts'
      return finish(5, 'http-error', 'artifact too large')
    }
    const dest = join(opts.outDir, jobId)
    const names = Object.keys(files).filter((n) => !n.endsWith('/')).sort()
    for (const n of names) {
      if (n.startsWith('/') || n.split(/[\\/]/).includes('..')) {
        ev.error = `unsafe artifact entry: ${n}`
        return finish(5, 'http-error', 'zip-slip rejected')
      }
    }
    for (const n of names) {
      const p = join(dest, n)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, files[n])
    }
    ev.outputFiles = names
    if (names.length) ev.firstOutputLines = strFromU8(files[names[0]]).split('\n').slice(0, 15)
    ev.countable = observed
    log(`artifact saved under ${dest}`)
    return finish(0, 'succeeded', observed ? 'ok' : 'usage-unknown')
  } catch (err) {
    ev.error = err instanceof Error ? err.message : String(err)
    log(`transport error: ${ev.error}`)
    // CR-52b: a refused connection or an unresolvable host never delivered a request, so nothing can have been spent.
    if (ev.jobId === null && neverSent(err)) {
      ev.estCostUsd = 0
      return finish(5, 'transport-error', 'transport-error; no request reached the server, no reserve kept')
    }
    return finish(5, 'transport-error', 'transport-error; reserve kept')
  }
}

async function main(): Promise<void> {
  let opts: Opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`${(e as Error).message}\nusage: tryout-run.ts --agent <slug> --task <text> --label public|synthetic [--plan 25-01] [--file f] [--base-url u] [--origin o] [--ledger p] [--out-dir d] [--timeout-s n] [--poll-ms n] [--price-per-mtok n]`)
    process.exit(2)
  }
  process.exit(await runJob(opts))
}

const isMain = isMainModule(import.meta.url, process.argv[1])
if (isMain) void main()
