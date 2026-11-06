import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { parseArgs, readLedgerTotal, guardBudget, estimateCostUsd, runJob, UsageError } from './tryout-run'

const HEADER = `# Spend log
| run_id | date | plan | agent | job_id | model | total_tokens | requests | cost_usd | status | note |
|---|---|---|---|---|---|---|---|---|---|---|
`

let dir: string
let ledger: string
let server: http.Server
let base: string
let hits: string[]
let polls: number
let mode: { fail?: boolean; hang?: boolean; usage?: boolean }

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tryout-'))
  ledger = join(dir, 'spend.md')
  writeFileSync(ledger, HEADER)
  hits = []
  polls = 0
  mode = { usage: true }
  server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url} origin=${req.headers.origin} cookie=${req.headers.cookie ?? ''}`)
    req.resume()
    req.on('end', () => {
      const url = req.url ?? ''
      if (req.method === 'POST' && url === '/api/tryitout/jobs') {
        res.setHeader('set-cookie', 'sid=abc; Path=/; HttpOnly')
        res.setHeader('content-type', 'application/json')
        return void res.end(JSON.stringify({ jobId: 'job-1', status: 'queued' }))
      }
      if (url === '/api/tryitout/jobs/job-1') {
        polls++
        const status = mode.hang ? 'running' : polls < 2 ? 'running' : mode.fail ? 'failed' : 'succeeded'
        res.setHeader('content-type', 'application/json')
        return void res.end(JSON.stringify({ status, events: [], error: status === 'failed' ? 'boom' : null }))
      }
      if (url === '/api/tryitout/jobs/job-1/usage') {
        if (!mode.usage) { res.statusCode = 404; return void res.end('{}') }
        res.setHeader('content-type', 'application/json')
        return void res.end(JSON.stringify({ model: 'gpt-4.1-mini', totalTokens: 5000, requests: 3, budgetExceeded: false }))
      }
      if (url === '/api/tryitout/jobs/job-1/artifact') {
        const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
        return void res.end(Buffer.from(zipSync({ 'result.md': strToU8(lines) })))
      }
      res.statusCode = 404
      res.end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterEach(async () => {
  await new Promise((r) => server.close(r))
  rmSync(dir, { recursive: true, force: true })
})

const opts = (extra: Record<string, unknown> = {}) => ({
  ...parseArgs(['--agent', 'a', '--task', 't', '--label', 'synthetic', '--plan', '25-01', '--base-url', base, '--ledger', ledger, '--out-dir', join(dir, 'runs'), '--poll-ms', '10', '--timeout-s', '5']),
  ...extra,
})
const quiet = { log: () => {}, out: (s: string) => outs.push(s) }
let outs: string[] = []
beforeEach(() => { outs = [] })

describe('parseArgs', () => {
  it('applies defaults', () => {
    const o = parseArgs(['--agent', 'a', '--task', 't', '--label', 'public'])
    expect(o.baseUrl).toBe('http://127.0.0.1:3000')
    expect(o.origin).toBe('http://127.0.0.1:3000')
    expect(o.ledger).toBe('.planning/spend-log.md')
    expect(o.timeoutS).toBe(400)
    expect(o.pollMs).toBe(2000)
    expect(o.pricePerMtok).toBe(1.6)
  })
  it('parses all flags', () => {
    const o = parseArgs(['--agent', 'a', '--task', 't', '--label', 'public', '--file', 'f', '--origin', 'http://x', '--out-dir', 'o', '--plan', 'p', '--price-per-mtok', '2'])
    expect(o).toMatchObject({ file: 'f', origin: 'http://x', outDir: 'o', plan: 'p', pricePerMtok: 2 })
  })
  it.each([[['--task', 't', '--label', 'public']], [['--agent', 'a', '--label', 'public']], [['--agent', 'a', '--task', 't']]])('throws UsageError on missing required %#', (argv) => {
    expect(() => parseArgs(argv)).toThrow(UsageError)
  })
})

describe('ledger and budget', () => {
  it('readLedgerTotal sums cost_usd and tolerates missing file', () => {
    expect(readLedgerTotal(join(dir, 'nope.md'))).toBe(0)
    writeFileSync(ledger, HEADER + '| r1 | d | p | a | j | m | 1 | 1 | 0.1200 | ok | |\n| r2 | d | p | a | j | m | 1 | 1 | 0.3000 | ok | |\n\nnot a row 5.0\n')
    expect(readLedgerTotal(ledger)).toBe(0.42)
    writeFileSync(ledger, '')
    expect(readLedgerTotal(ledger)).toBe(0)
  })
  it('guardBudget', () => {
    expect(guardBudget(9.51)).toBe(false)
    expect(guardBudget(9.5)).toBe(true)
  })
  it('estimateCostUsd', () => {
    expect(estimateCostUsd(100000, 1.6)).toBe(0.16)
    expect(estimateCostUsd(1234, 1.6)).toBe(0.0020)
  })
})

describe('runJob', () => {
  it('refuses over budget with zero HTTP calls', async () => {
    writeFileSync(ledger, HEADER + '| r1 | d | p | a | j | m | 1 | 1 | 9.5100 | ok | |\n')
    expect(await runJob(opts(), quiet)).toBe(3)
    expect(hits).toHaveLength(0)
  })

  it('happy path', async () => {
    const f = join(dir, 'in.txt')
    writeFileSync(f, 'hello')
    expect(await runJob(opts({ file: f }), quiet)).toBe(0)
    expect(hits[0]).toContain(`origin=${base}`)
    expect(hits[1]).toContain('cookie=sid=abc')
    const ev = JSON.parse(outs[0])
    expect(ev).toMatchObject({ jobId: 'job-1', status: 'succeeded', model: 'gpt-4.1-mini', totalTokens: 5000, requests: 3, estCostUsd: 0.008, countable: true, outputFiles: ['result.md'] })
    expect(ev.firstOutputLines).toHaveLength(15)
    expect(readFileSync(join(dir, 'runs', 'job-1', 'result.md'), 'utf8')).toContain('line 20')
    const rows = readFileSync(ledger, 'utf8').split('\n').filter((l) => l.includes(' a | job-1'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('0.0080')
    expect(readLedgerTotal(ledger)).toBe(0.008)
  })

  it('failed job still logs a row', async () => {
    mode.fail = true
    expect(await runJob(opts(), quiet)).toBe(1)
    expect(readLedgerTotal(ledger)).toBe(0.008)
    expect(readFileSync(ledger, 'utf8')).toContain('failed')
  })

  it('failed job with unknown usage keeps the reserve', async () => {
    mode.fail = true
    mode.usage = false
    expect(await runJob(opts(), quiet)).toBe(1)
    expect(readLedgerTotal(ledger)).toBe(0.5)
    expect(readFileSync(ledger, 'utf8')).toContain('usage-unknown')
  })

  it('timeout writes reserve row', async () => {
    mode.hang = true
    expect(await runJob(opts({ timeoutS: 0.05 }), quiet)).toBe(4)
    expect(readLedgerTotal(ledger)).toBe(0.5)
  })

  it('usage 404 -> not countable, reserve kept', async () => {
    mode.usage = false
    expect(await runJob(opts(), quiet)).toBe(0)
    expect(JSON.parse(outs[0]).countable).toBe(false)
    expect(readLedgerTotal(ledger)).toBe(0.5)
    expect(readFileSync(ledger, 'utf8')).toContain('usage-unknown')
  })

  // CR-52: a connection that never reached a server spent nothing, so no reserve is kept (it used to keep 0.50 USD).
  it('transport error returns 5 and keeps no reserve when no request was sent', async () => {
    expect(await runJob(opts({ baseUrl: 'http://127.0.0.1:1' }), quiet)).toBe(5)
    expect(readLedgerTotal(ledger)).toBe(0)
    expect(existsSync(join(dir, 'runs')) ? readdirSync(join(dir, 'runs')) : []).toEqual([])
  })
})
