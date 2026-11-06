// Review 23: CR-52 (timeouts, over-counted spend, ledger lock) and CR-53 (job id, artifact size).
import http from 'node:http'
import net from 'node:net'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseArgs, readLedgerTotal, runJob, withLedgerLock } from './tryout-run'

const HEADER = `# Spend log
| run_id | date | plan | agent | job_id | model | total_tokens | requests | cost_usd | status | note |
|---|---|---|---|---|---|---|---|---|---|---|
`
let dir: string
let ledger: string
let server: http.Server
let base: string
let hits: string[]
let behaviour: (req: http.IncomingMessage, res: http.ServerResponse) => void
const quiet = { log: () => {}, out: () => {} }

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tryout-r23-'))
  ledger = join(dir, 'spend.md')
  writeFileSync(ledger, HEADER)
  hits = []
  server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`)
    req.resume()
    req.on('end', () => behaviour(req, res))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterEach(async () => {
  server.closeAllConnections?.()
  await new Promise((r) => server.close(r))
  rmSync(dir, { recursive: true, force: true })
})
const opts = (extra: Record<string, unknown> = {}) => ({
  ...parseArgs(['--agent', 'a', '--task', 't', '--label', 'synthetic', '--plan', '25-01', '--base-url', base, '--ledger', ledger, '--out-dir', join(dir, 'runs'), '--poll-ms', '10', '--timeout-s', '5']),
  ...extra,
})
const json = (res: http.ServerResponse, body: unknown) => {
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

describe('request timeouts (CR-52a)', () => {
  it('a server that accepts and never answers does not hang the run', async () => {
    behaviour = () => {}
    const t0 = Date.now()
    const code = await runJob(opts({ timeoutS: 1 }), quiet)
    expect(Date.now() - t0).toBeLessThan(15_000)
    expect(code).toBe(5)
    // The request may have been delivered, so the reserve is kept.
    expect(readLedgerTotal(ledger)).toBe(0.5)
  }, 30_000)
})

describe('spend that cannot have happened (CR-52b)', () => {
  it('an unreadable --file reserves nothing and sends nothing', async () => {
    behaviour = (_q, res) => json(res, {})
    expect(await runJob(opts({ file: join(dir, 'missing.txt') }), quiet)).toBe(2)
    expect(readLedgerTotal(ledger)).toBe(0)
    expect(hits).toEqual([])
  })
  it('a refused connection keeps no reserve', async () => {
    const free = await new Promise<number>((r) => {
      const s = net.createServer().listen(0, '127.0.0.1', () => {
        const p = (s.address() as net.AddressInfo).port
        s.close(() => r(p))
      })
    })
    expect(await runJob(opts({ baseUrl: `http://127.0.0.1:${free}` }), quiet)).toBe(5)
    expect(readLedgerTotal(ledger)).toBe(0)
  })
})

describe('ledger lock (CR-52c)', () => {
  it('serialises holders and removes the lock file', () => {
    const order: string[] = []
    withLedgerLock(ledger, () => {
      order.push('outer')
      expect(existsSync(`${ledger}.lock`)).toBe(true)
    })
    withLedgerLock(ledger, () => order.push('second'))
    expect(order).toEqual(['outer', 'second'])
    expect(existsSync(`${ledger}.lock`)).toBe(false)
  })
  it('releases the lock when the callback throws', () => {
    expect(() => withLedgerLock(ledger, () => { throw new Error('x') })).toThrow('x')
    expect(existsSync(`${ledger}.lock`)).toBe(false)
  })
})

describe('server-supplied values (CR-53)', () => {
  it('rejects a job id that is not a plain token, and never writes outside --out-dir', async () => {
    behaviour = (req, res) => json(res, req.method === 'POST' ? { jobId: '../../escape', status: 'queued' } : {})
    expect(await runJob(opts(), quiet)).toBe(5)
    expect(hits).toEqual(['POST /api/tryitout/jobs'])
    expect(existsSync(join(dir, 'runs'))).toBe(false)
    expect(readdirSync(dir).sort()).toEqual(['spend.md'])
  })
  it('refuses an artifact whose declared size is far above the cap', async () => {
    const bomb = Buffer.from(zipSync({ 'big.txt': new Uint8Array(25_000_000) }))
    behaviour = (req, res) => {
      const u = req.url ?? ''
      if (req.method === 'POST') return json(res, { jobId: 'job-1' })
      if (u.endsWith('/usage')) return json(res, { model: 'm', totalTokens: 10, requests: 1 })
      if (u.endsWith('/artifact')) return void res.end(bomb)
      return json(res, { status: 'succeeded', events: [], error: null })
    }
    expect(await runJob(opts(), quiet)).toBe(5)
    expect(existsSync(join(dir, 'runs', 'job-1'))).toBe(false)
    expect(readFileSync(ledger, 'utf8')).toContain('artifact too large')
  })
})
