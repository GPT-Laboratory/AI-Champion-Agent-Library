import { describe, it, expect } from 'vitest'
import { runBehaviourCheck, behaviourDimension, type Identity, type ValidatorCtx } from './validators'
import type { BehaviourKind, ToolCaller, ToolOutcome } from './types'

const ok = (body: unknown, isError = false): ToolOutcome => ({
  kind: 'result',
  isError,
  text: typeof body === 'string' ? body : JSON.stringify(body),
  content: []
})

const identity: Identity = {
  idKeys: ['id', 'sku'],
  altKeys: ['code'],
  partitionKeys: ['vendor'],
  knownId: 'A-1',
  knownAlt: 'ALT-9',
  badId: 'ZZZ',
  partitionValue: 'Acme',
  expectedDerivedIds: ['A-1', 'B-2'],
  maxPage: 10,
  ceilingPage: 20
}

function scripted(reply: (name: string, args: Record<string, unknown>) => ToolOutcome, seen: Array<Record<string, unknown>> = []) {
  const caller: ToolCaller = {
    tools: [{ name: 'tool_a' }],
    async call(name, args) {
      seen.push(args)
      return reply(name, args)
    }
  }
  return caller
}

function ctxFor(reply: (n: string, a: Record<string, unknown>) => ToolOutcome, over: Partial<ValidatorCtx> = {}, args: Record<string, unknown> = {}): ValidatorCtx {
  return {
    caller: scripted(reply),
    identity,
    bind: () => ({ tool: 'tool_a', args, boundBy: 'explicit' }),
    ...over
  }
}

describe('dimension mapping', () => {
  it('checks 1-5 are D2, 6-10 are D4', () => {
    const kinds: BehaviourKind[] = ['lookup_by_id', 'lookup_by_alt_key', 'partition_filter', 'derived_filter', 'projection']
    for (const k of kinds) expect(behaviourDimension(k)).toBe('D2')
    for (const k of ['pagesize_clamp', 'pagination_ceiling', 'bad_input', 'empty_vs_error', 'auth_fail'] as BehaviourKind[]) {
      expect(behaviourDimension(k)).toBe('D4')
    }
  })
})

describe('lookups', () => {
  it('lookup_by_id pass/fail', async () => {
    expect((await runBehaviourCheck('lookup_by_id', ctxFor(() => ok({ data: { sku: 'A-1' } })))).status).toBe('PASS')
    expect((await runBehaviourCheck('lookup_by_id', ctxFor(() => ok({ data: { sku: 'Q' } })))).status).toBe('FAIL')
  })
  it('lookup_by_alt_key NA without knownAlt', async () => {
    const c = ctxFor(() => ok({}))
    c.identity = { ...identity, knownAlt: undefined }
    expect((await runBehaviourCheck('lookup_by_alt_key', c)).status).toBe('NA')
  })
  it('lookup_by_alt_key finds alt value', async () => {
    expect((await runBehaviourCheck('lookup_by_alt_key', ctxFor(() => ok([{ code: 'ALT-9' }])))).status).toBe('PASS')
  })
})

describe('partition_filter', () => {
  it('passes when all items attributable through any rule', async () => {
    const r = await runBehaviourCheck('partition_filter', ctxFor(() => ok([{ id: '1', vendor_name: 'Acme' }, { id: '2', note: 'by Acme' }])))
    expect(r.status).toBe('PASS')
  })
  it('fails on stray item or zero items', async () => {
    expect((await runBehaviourCheck('partition_filter', ctxFor(() => ok([{ id: '1', vendor: 'Acme' }, { id: '2', vendor: 'Other' }])))).status).toBe('FAIL')
    expect((await runBehaviourCheck('partition_filter', ctxFor(() => ok([])))).status).toBe('FAIL')
  })
})

describe('derived_filter', () => {
  it('requires all expected ids, extras allowed', async () => {
    expect((await runBehaviourCheck('derived_filter', ctxFor(() => ok('A-1 B-2 C-3')))).status).toBe('PASS')
    expect((await runBehaviourCheck('derived_filter', ctxFor(() => ok('A-1 only')))).status).toBe('FAIL')
  })
  it('no bound tool is FAIL not ERROR', async () => {
    const r = await runBehaviourCheck('derived_filter', ctxFor(() => ok(''), { bind: () => ({ args: {}, boundBy: 'none' }) }))
    expect(r.status).toBe('FAIL')
    expect(r.reason).toBe('no tool')
  })
})

describe('projection', () => {
  const wide = (n: number) => ({ id: 'A-1', ...Object.fromEntries(Array.from({ length: n - 1 }, (_, i) => [`f${i}`, i])) })
  it('12 fields pass, 13 fail, configurable', async () => {
    expect((await runBehaviourCheck('projection', ctxFor(() => ok(wide(12))))).status).toBe('PASS')
    expect((await runBehaviourCheck('projection', ctxFor(() => ok(wide(13))))).status).toBe('FAIL')
    const c = ctxFor(() => ok(wide(13)))
    c.identity = { ...identity, projectionMax: 15 }
    expect((await runBehaviourCheck('projection', c)).status).toBe('PASS')
  })
})

describe('pagesize_clamp', () => {
  const items = (n: number) => ok(Array.from({ length: n }, (_, i) => ({ id: `I${i}` })))
  it('asks 5x max via placeholder', async () => {
    const seen: Array<Record<string, unknown>> = []
    const c = ctxFor(() => items(3), { caller: scripted(() => items(3), seen) }, { limit: '{{pageSize}}' })
    c.caller = scripted(() => items(3), seen)
    await runBehaviourCheck('pagesize_clamp', c)
    expect(seen[0]).toEqual({ limit: 50 })
  })
  it.each([
    ['leak', ok('Traceback (most recent call last)'), 'FAIL'],
    ['isError clean reject', ok('page size too large', true), 'PASS'],
    ['over max', items(11), 'FAIL'],
    ['within max', items(10), 'PASS']
  ])('%s -> %s', async (_n, outcome, want) => {
    expect((await runBehaviourCheck('pagesize_clamp', ctxFor(() => outcome as ToolOutcome))).status).toBe(want)
  })
})

describe('pagination_ceiling', () => {
  it('NA when ceiling null or undefined', async () => {
    for (const ceilingPage of [null, undefined]) {
      const c = ctxFor(() => ok('x'))
      c.identity = { ...identity, ceilingPage }
      expect((await runBehaviourCheck('pagination_ceiling', c)).status).toBe('NA')
    }
  })
  it('requests beyond ceiling; leak FAIL else PASS', async () => {
    const seen: Array<Record<string, unknown>> = []
    const c = ctxFor(() => ok('Page out of range'), {}, { page: '{{page}}' })
    c.caller = scripted(() => ok('Page out of range'), seen)
    expect((await runBehaviourCheck('pagination_ceiling', c)).status).toBe('PASS')
    expect(seen[0]).toEqual({ page: 21 })
    expect((await runBehaviourCheck('pagination_ceiling', ctxFor(() => ok('{"timestamp":1,"status":500,"error":"x","path":"/"}')))).status).toBe('FAIL')
  })
})

describe('bad_input order', () => {
  it('leak first', async () => {
    expect((await runBehaviourCheck('bad_input', ctxFor(() => ok('not found ConnectionError', true)))).status).toBe('FAIL')
  })
  it('explicit signal BEFORE product detection: echoing the id is not a hit', async () => {
    const r = await runBehaviourCheck('bad_input', ctxFor(() => ok({ id: 'ZZZ', message: 'Item ZZZ not found' })))
    expect(r.status).toBe('PASS')
  })
  it('isError passes', async () => {
    expect((await runBehaviourCheck('bad_input', ctxFor(() => ok('nope', true)))).status).toBe('PASS')
  })
  it('returned item without signal fails; no signal fails', async () => {
    const a = await runBehaviourCheck('bad_input', ctxFor(() => ok({ id: 'Q', name: 'Something' })))
    expect(a.status).toBe('FAIL')
    expect(a.reason).toMatch(/returned an item/)
    expect((await runBehaviourCheck('bad_input', ctxFor(() => ok('hello')))).status).toBe('FAIL')
  })
})

describe('empty_vs_error', () => {
  it.each([
    ['empty with message', ok({ items: [], message: 'No results' }), 'PASS'],
    ['raw empty envelope', ok({ items: [] }), 'FAIL'],
    ['leak', ok('JSONDecodeError'), 'FAIL'],
    ['items returned', ok([{ id: '1' }]), 'FAIL']
  ])('%s -> %s', async (_n, outcome, want) => {
    expect((await runBehaviourCheck('empty_vs_error', ctxFor(() => outcome as ToolOutcome))).status).toBe(want)
  })
})

describe('auth_fail', () => {
  const relaunch = (o: ToolOutcome) => async (key: string) => {
    expect(key).toBeTruthy()
    return scripted(() => o)
  }
  it('NA when relaunch absent', async () => {
    const r = await runBehaviourCheck('auth_fail', ctxFor(() => ok('x')))
    expect(r).toMatchObject({ status: 'NA', reason: 'relaunch unavailable' })
  })
  it('NA when relaunch returns null', async () => {
    expect((await runBehaviourCheck('auth_fail', ctxFor(() => ok('x'), { relaunchWithKey: async () => null }))).status).toBe('NA')
  })
  it.each([
    ['auth words result', ok('Unauthorized: bad api key', true), 'PASS'],
    ['transport with auth words', { kind: 'transport_error', message: 'HTTP 401 forbidden' } as ToolOutcome, 'PASS'],
    ['transport without auth words', { kind: 'transport_error', message: 'socket closed' } as ToolOutcome, 'FAIL'],
    ['generic isError text', ok('Something went wrong', true), 'FAIL'],
    ['loose invalid word is not enough', ok('invalid request', true), 'FAIL'],
    ['leak', ok('401 httpx.HTTPStatusError', true), 'FAIL']
  ])('%s -> %s', async (_n, outcome, want) => {
    const r = await runBehaviourCheck('auth_fail', ctxFor(() => ok('x'), { relaunchWithKey: relaunch(outcome as ToolOutcome) }))
    expect(r.status).toBe(want)
  })
})

describe('binding outcomes and result shape', () => {
  it('ambiguous binding is ERROR with boundBy recorded', async () => {
    const r = await runBehaviourCheck('lookup_by_id', ctxFor(() => ok(''), { bind: () => ({ args: {}, boundBy: 'hint', error: 'ambiguous binding' }) }))
    expect(r).toMatchObject({ status: 'ERROR', reason: 'ambiguous binding', boundBy: 'hint' })
  })
  it('no tool is FAIL', async () => {
    const r = await runBehaviourCheck('lookup_by_id', ctxFor(() => ok(''), { bind: () => ({ args: {}, boundBy: 'none' }) }))
    expect(r.status).toBe('FAIL')
  })
  it('carries id, kind, dimension, boundBy', async () => {
    const r = await runBehaviourCheck('lookup_by_id', ctxFor(() => ok({ id: 'A-1' })))
    expect(r).toMatchObject({ id: 'lookup_by_id', kind: 'lookup_by_id', dimension: 'D2', boundBy: 'explicit' })
  })
  it('caps and redacts reasons', async () => {
    const r = await runBehaviourCheck('lookup_by_id', ctxFor(() => ok(''), { bind: () => ({ args: {}, boundBy: 'hint', error: 'secret-token '.repeat(40) }), redact: (s) => s.replace(/secret-token/g, '[x]') }))
    expect(r.reason.length).toBeLessThanOrEqual(200)
    expect(r.reason).not.toContain('secret-token')
  })
  it('never throws: caller exception becomes ERROR', async () => {
    const c = ctxFor(() => ok(''))
    c.caller = {
      tools: [],
      async call() {
        throw new Error('boom')
      }
    }
    const r = await runBehaviourCheck('lookup_by_id', c)
    expect(r.status).toBe('ERROR')
    expect(r.reason).toMatch(/validator exception: boom/)
  })
})
