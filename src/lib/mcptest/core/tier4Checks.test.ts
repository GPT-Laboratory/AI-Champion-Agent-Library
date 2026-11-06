import { describe, it, expect } from 'vitest'
import { request } from 'node:http'
import { runTier4Check, type SpecialCtx } from './tier4Checks'
import { withMock } from '../mock/testing'
import { codesDataset } from '../mock/datasets'
import type { MockHandle } from '../mock/spec'
import type { ToolCaller, ToolInfo, ToolOutcome } from './types'

const CANARY = 'canary-not-a-real-key'
const ok = (body: unknown): ToolOutcome => ({
  kind: 'result',
  isError: false,
  text: typeof body === 'string' ? body : JSON.stringify(body),
  content: []
})
const err = (text: string): ToolOutcome => ({ kind: 'result', isError: true, text, content: [] })

const caller = (tools: ToolInfo[], fn: (name: string, args: Record<string, unknown>, opts?: { timeoutMs?: number }) => Promise<ToolOutcome> | ToolOutcome): ToolCaller => ({
  tools,
  call: async (name, args, opts) => fn(name, args, opts)
})

const search: ToolInfo[] = [{ name: 'search_items', description: 'Search items' }]

const ctxFor = (c: ToolCaller, mock: MockHandle, over: Partial<SpecialCtx> = {}): SpecialCtx => ({
  caller: c,
  mock,
  bind: () => ({ tool: c.tools[0]?.name, args: { q: 'acme' }, boundBy: 'explicit' }),
  config: {},
  ...over
})

const CAT = { datasets: ['catalog' as const] }

// ---- fault_retry --------------------------------------------------------

/** Simulates a client that retries 429/5xx up to `max` attempts. */
const retrying = (m: MockHandle, max: number) =>
  caller(search, async () => {
    for (let i = 1; i <= max; i++) {
      const r = await fetch(`${m.url}/items?q=acme`)
      const text = await r.text()
      if (r.ok) return ok(text)
    }
    return err('Upstream unavailable after retries')
  })

describe('fault_retry', () => {
  it('passes when transient faults are retried within bounds', async () => {
    await withMock(CAT, async (m) => {
      const r = await runTier4Check('fault_retry', ctxFor(retrying(m, 4), m))
      expect(r).toHaveLength(1)
      expect(r[0]).toMatchObject({ id: 'fault_retry', dimension: 'D4', status: 'PASS' })
      expect(r[0].flags).toBeUndefined()
    })
  })

  it('fails with a NO_RETRY warning when a transient error is not retried', async () => {
    await withMock(CAT, async (m) => {
      const r = await runTier4Check('fault_retry', ctxFor(retrying(m, 1), m))
      expect(r[0].status).toBe('FAIL')
      expect(r[0].flags?.[0]).toMatchObject({ id: 'NO_RETRY', severity: 'warning' })
      expect(r[0].reason).toMatch(/no retry/)
    })
  })

  it('fails unbounded retries', async () => {
    await withMock(CAT, async (m) => {
      const hammer = caller(search, async () => {
        for (let i = 0; i < 9; i++) await (await fetch(`${m.url}/items?q=acme`)).text()
        return ok({ items: [] })
      })
      const r = await runTier4Check('fault_retry', ctxFor(hammer, m))
      expect(r[0].status).toBe('FAIL')
      expect(r[0].reason).toMatch(/unbounded retries/)
    })
  })

  it('fails (not NO_RETRY) when retried but still failing', async () => {
    await withMock(CAT, async (m) => {
      const r = await runTier4Check('fault_retry', ctxFor(retrying(m, 2), m))
      // 429 x2 is exhausted after 2 attempts -> third needed; client gives up
      expect(r[0].status).toBe('FAIL')
      expect(r[0].reason).toMatch(/still failing after 2 attempts/)
      expect(r[0].flags).toBeUndefined()
    })
  })

  it('returns ERROR for an ambiguous binding and never throws', async () => {
    await withMock(CAT, async (m) => {
      const c = retrying(m, 3)
      const r = await runTier4Check('fault_retry', ctxFor(c, m, { bind: () => ({ args: {}, boundBy: 'none', error: 'ambiguous' }) }))
      expect(r[0].status).toBe('ERROR')
      const thrower = { ...ctxFor(c, m), bind: () => { throw new Error('bind blew up') } }
      expect((await runTier4Check('fault_retry', thrower as SpecialCtx))[0].status).toBe('ERROR')
    })
  })
})

// ---- fault_timeout ------------------------------------------------------

describe('fault_timeout', () => {
  const clockCtx = (c: ToolCaller, m: MockHandle, ticks: number[]) => {
    let i = 0
    return ctxFor(c, m, { now: () => ticks[Math.min(i++, ticks.length - 1)], config: { timeoutMs: 100, slackMs: 50 } })
  }

  it('passes an honest error returned in time', async () => {
    await withMock(CAT, async (m) => {
      const c = caller(search, () => err('Upstream timed out, please retry'))
      const r = await runTier4Check('fault_timeout', clockCtx(c, m, [0, 20]))
      expect(r[0].status).toBe('PASS')
    })
  })

  it('passes the deadline plus slack and fails beyond it (injected clock)', async () => {
    await withMock(CAT, async (m) => {
      const c = caller(search, () => err('timed out'))
      expect((await runTier4Check('fault_timeout', clockCtx(c, m, [0, 150])))[0].status).toBe('PASS')
      const late = await runTier4Check('fault_timeout', clockCtx(c, m, [0, 151]))
      expect(late[0].status).toBe('FAIL')
      expect(late[0].reason).toMatch(/answered after 151ms/)
    })
  })

  it('fails when the caller reports a timed out transport', async () => {
    await withMock(CAT, async (m) => {
      const c = caller(search, (_n, _a, opts) => ({ kind: 'transport_error', message: `no reply in ${opts?.timeoutMs}`, timedOut: true }))
      const r = await runTier4Check('fault_timeout', clockCtx(c, m, [0, 10]))
      expect(r[0].status).toBe('FAIL')
      expect(r[0].reason).toMatch(/deadline/)
    })
  })

  it('passes opts.timeoutMs to the caller and injects the timeout fault', async () => {
    await withMock(CAT, async (m) => {
      let seen: number | undefined
      const c = caller(search, async (_n, _a, opts) => {
        seen = opts?.timeoutMs
        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), 60)
        try {
          await fetch(`${m.url}/items?q=acme`, { signal: ac.signal })
          return ok({ items: [] })
        } catch {
          return err('Upstream did not answer in time')
        } finally {
          clearTimeout(timer)
        }
      })
      const r = await runTier4Check('fault_timeout', ctxFor(c, m, { config: { timeoutMs: 100 } }))
      expect(seen).toBe(100)
      expect(r[0].status).toBe('PASS')
      expect(m.log()[0].fault).toBe('timeout')
    })
  })

  it('fails items returned despite a timeout, and flags leaks', async () => {
    await withMock(CAT, async (m) => {
      const items = caller(search, () => ok({ items: [{ id: 'ACM-1', name: 'Acme Thing' }] }))
      expect((await runTier4Check('fault_timeout', clockCtx(items, m, [0, 1])))[0].status).toBe('FAIL')
      const leaky = caller(search, () => err('httpx.ReadTimeout'))
      const r = await runTier4Check('fault_timeout', clockCtx(leaky, m, [0, 1]))
      expect(r[0].flags?.[0].id).toBe('LEAK')
    })
  })
})

// ---- fault_malformed ----------------------------------------------------

describe('fault_malformed', () => {
  const clientWith = (m: MockHandle, onBad: () => ToolOutcome) =>
    caller(search, async () => {
      const r = await fetch(`${m.url}/items?q=acme`)
      const text = await r.text()
      try {
        return ok(JSON.parse(text))
      } catch {
        return onBad()
      }
    })

  it('passes when malformed bodies are reported as errors or empty answers', async () => {
    await withMock(CAT, async (m) => {
      const r = await runTier4Check('fault_malformed', ctxFor(clientWith(m, () => err('Upstream returned an invalid response')), m))
      expect(r[0]).toMatchObject({ id: 'fault_malformed', dimension: 'D4', status: 'PASS' })
    })
  })

  it('fails with CONFIDENT_WRONG when items are fabricated', async () => {
    await withMock(CAT, async (m) => {
      const r = await runTier4Check('fault_malformed', ctxFor(clientWith(m, () => ok({ items: [{ id: 'ACM-1', name: 'Acme Guess' }] })), m))
      expect(r[0].status).toBe('FAIL')
      expect(r[0].flags?.some((f) => f.id === 'CONFIDENT_WRONG' && f.severity === 'blocker')).toBe(true)
    })
  })

  it('fails with LEAK when parser errors surface', async () => {
    await withMock(CAT, async (m) => {
      const r = await runTier4Check('fault_malformed', ctxFor(clientWith(m, () => err('JSONDecodeError: Expecting value')), m))
      expect(r[0].status).toBe('FAIL')
      expect(r[0].flags?.[0]).toMatchObject({ id: 'LEAK', severity: 'blocker' })
    })
  })

  it('fails on transport crashes without a flag', async () => {
    await withMock(CAT, async (m) => {
      const c = caller(search, () => ({ kind: 'transport_error', message: 'server died' }))
      const r = await runTier4Check('fault_malformed', ctxFor(c, m))
      expect(r[0].status).toBe('FAIL')
      expect(r[0].flags).toBeUndefined()
    })
  })
})

// ---- secret_canary ------------------------------------------------------

const rawGet = (m: MockHandle, path: string) =>
  new Promise<string>((resolve) => {
    const r = request({ host: '127.0.0.1', port: m.port, path, method: 'GET' }, (res) => {
      let b = ''
      res.on('data', (d) => (b += d))
      res.on('end', () => resolve(b))
    })
    r.on('error', () => resolve(''))
    r.end()
  })

describe('secret_canary', () => {
  const tools: ToolInfo[] = [{ name: 'search_items' }, { name: 'lookup_item' }]
  const safeClient = (m: MockHandle) =>
    caller(tools, async (_n, a) => ok(await (await fetch(`${m.url}/items?q=${encodeURIComponent(String(a.q ?? 'acme'))}`)).text()))
  const byId = (rs: { id: string; status: string }[]) => Object.fromEntries(rs.map((r) => [r.id, r.status]))

  it('passes a clean server on all three parts', async () => {
    await withMock(CAT, async (m) => {
      const r = await runTier4Check('secret_canary', ctxFor(safeClient(m), m, { canary: CANARY, stderr: () => 'listening' }))
      expect(byId(r)).toEqual({ 'secret_canary.echo': 'PASS', 'secret_canary.write_tools': 'PASS', 'secret_canary.injection': 'PASS' })
      expect(r.every((x) => x.dimension === 'D4' && x.kind === 'secret_canary')).toBe(true)
    })
  })

  it('fails with SECRET_ECHO when the canary shows up in output or stderr, without repeating it', async () => {
    await withMock(CAT, async (m) => {
      const echo = caller(tools, (n) => ok(`key=${CANARY} via ${n}`))
      const a = await runTier4Check('secret_canary', ctxFor(echo, m, { canary: CANARY }))
      expect(a[0].status).toBe('FAIL')
      expect(a[0].flags?.[0]).toMatchObject({ id: 'SECRET_ECHO', severity: 'blocker' })
      expect(JSON.stringify(a)).not.toContain(CANARY)
      const b = await runTier4Check('secret_canary', ctxFor(safeClient(m), m, { canary: CANARY, stderr: () => `debug ${CANARY}` }))
      expect(b[0].reason).toMatch(/stderr/)
      expect(b[0].flags?.[0].id).toBe('SECRET_ECHO')
    })
  })

  it('reports ERROR for the echo part when no canary is configured', async () => {
    await withMock(CAT, async (m) => {
      const r = await runTier4Check('secret_canary', ctxFor(safeClient(m), m))
      expect(r[0].status).toBe('ERROR')
    })
  })

  it('flags write-like tool names and readOnlyHint false', async () => {
    await withMock(CAT, async (m) => {
      const named = caller([{ name: 'search_items' }, { name: 'delete_item' }], () => ok({}))
      const a = await runTier4Check('secret_canary', ctxFor(named, m, { canary: CANARY }))
      const w = a.find((x) => x.id === 'secret_canary.write_tools')
      expect(w?.status).toBe('FAIL')
      expect(w?.flags?.[0]).toMatchObject({ id: 'WRITE_TOOL', severity: 'blocker' })
      const hinted = caller([{ name: 'search_items', annotations: { readOnlyHint: false } }], () => ok({}))
      const b = await runTier4Check('secret_canary', ctxFor(hinted, m, { canary: CANARY }))
      expect(b.find((x) => x.id === 'secret_canary.write_tools')?.status).toBe('FAIL')
    })
  })

  it('flags non-GET upstream traffic', async () => {
    await withMock(CAT, async (m) => {
      const poster = caller(search, async () => {
        await fetch(`${m.url}/items`, { method: 'POST' })
        return ok({})
      })
      const r = await runTier4Check('secret_canary', ctxFor(poster, m, { canary: CANARY }))
      const w = r.find((x) => x.id === 'secret_canary.write_tools')
      expect(w?.status).toBe('FAIL')
      expect(w?.reason).toMatch(/POST/)
    })
  })

  it('fails unescaped hostile input in the upstream path', async () => {
    await withMock(CAT, async (m) => {
      const naive = caller(search, async (_n, a) => ok(await rawGet(m, `/items/${String(a.q)}`)))
      const r = await runTier4Check('secret_canary', ctxFor(naive, m, { canary: CANARY }))
      const inj = r.find((x) => x.id === 'secret_canary.injection')
      expect(inj?.status).toBe('FAIL')
      expect(inj?.reason).toMatch(/path traversal/)
    })
  })

  it('flags a LEAK surfaced by hostile input', async () => {
    await withMock(CAT, async (m) => {
      const c = caller(search, (_n, a) => (String(a.q).length > 1000 ? err('Traceback (most recent call last)') : ok({})))
      const r = await runTier4Check('secret_canary', ctxFor(c, m, { canary: CANARY }))
      const inj = r.find((x) => x.id === 'secret_canary.injection')
      expect(inj?.status).toBe('FAIL')
      expect(inj?.flags?.[0].id).toBe('LEAK')
    })
  })
})

// ---- i18n_codes ---------------------------------------------------------

describe('i18n_codes', () => {
  const NAME = 'Äänekoski Tuote ö'
  const codes = codesDataset(1)
  const cfg = { invalidCode: codes.invalid[0], validCode: codes.valid[0].gtin, expectedName: NAME, codeArg: 'code' }
  const gtin: ToolInfo[] = [{ name: 'lookup_product_by_gtin' }]
  const ctx = (c: ToolCaller, m: MockHandle) => ctxFor(c, m, { config: cfg, bind: () => ({ tool: 'lookup_product_by_gtin', args: { code: '' }, boundBy: 'explicit' }) })

  const checked = (m: MockHandle, mangle = false) =>
    caller(gtin, async (_n, a) => {
      const code = String(a.code)
      if (!/^\d{13}$/.test(code) || code === cfg.invalidCode) return err('invalid_input: check digit does not match')
      const p = await (await fetch(`${m.url}/products/by-gtin/${code}`)).json()
      const name = mangle ? NAME.replace(/[^\x00-\x7f]/g, '?') : NAME
      return ok({ ...p, names: { fi: name } })
    })

  it('passes validation before any upstream call and an intact UTF-8 round trip', async () => {
    await withMock({ datasets: ['codes'] }, async (m) => {
      const r = await runTier4Check('i18n_codes', ctx(checked(m), m))
      expect(r.map((x) => [x.id, x.status])).toEqual([
        ['i18n_codes.invalid', 'PASS'],
        ['i18n_codes.roundtrip', 'PASS']
      ])
    })
  })

  it('fails with UNVALIDATED_CODE when the invalid code reaches the upstream', async () => {
    await withMock({ datasets: ['codes'] }, async (m) => {
      const forwarder = caller(gtin, async (_n, a) => {
        const r = await fetch(`${m.url}/products/by-gtin/${String(a.code)}`)
        const body = await r.text()
        return r.ok ? ok({ names: { fi: NAME }, body }) : err('invalid_input')
      })
      const r = await runTier4Check('i18n_codes', ctx(forwarder, m))
      expect(r[0].status).toBe('FAIL')
      expect(r[0].flags?.[0]).toMatchObject({ id: 'UNVALIDATED_CODE', severity: 'warning' })
      expect(r[1].status).toBe('PASS')
    })
  })

  it('fails when the invalid code is not rejected and when non-ASCII is corrupted', async () => {
    await withMock({ datasets: ['codes'] }, async (m) => {
      const lax = caller(gtin, async () => ok({ names: { fi: NAME } }))
      expect((await runTier4Check('i18n_codes', ctx(lax, m)))[0].status).toBe('FAIL')
      const r = await runTier4Check('i18n_codes', ctx(checked(m, true), m))
      expect(r[1].status).toBe('FAIL')
      expect(r[1].reason).toMatch(/missing or corrupted/)
    })
  })

  it('returns ERROR when the configuration is incomplete', async () => {
    await withMock({ datasets: ['codes'] }, async (m) => {
      const r = await runTier4Check('i18n_codes', ctxFor(checked(m), m, { config: {} }))
      expect(r[0].status).toBe('ERROR')
    })
  })
})
