import { describe, expect, it } from 'vitest'
import { createRunStore, isValidRunId, MAX_EVENTS, MAX_REPORT_JSON_BYTES } from './jobs'

function mk(over: { ttlMs?: number; maxRuns?: number } = {}) {
  const clock = { t: 1_000_000 }
  const store = createRunStore({ ...over, now: () => clock.t })
  return { store, clock }
}

describe('run store', () => {
  it('creates queued records with a UUID id and validates ids', () => {
    const { store } = mk()
    const r = store.createRun('s1', 3)
    expect(isValidRunId(r.id)).toBe(true)
    expect(r.status).toBe('queued')
    expect(r.progress).toEqual({ done: 0, total: 3, current: null })
    expect(store.getRun(r.id)).toBe(r)
    expect(store.getRun('nope')).toBeNull()
    expect(store.getRun('../../etc/passwd')).toBeNull()
    expect(store.getRun('00000000-0000-4000-8000-000000000000')).toBeNull()
    expect(isValidRunId(5)).toBe(false)
  })

  it('caps events, truncates and redacts text', () => {
    const { store } = mk()
    const r = store.createRun('s')
    for (let i = 0; i < MAX_EVENTS + 20; i++) store.addEvent(r.id, `e${i}`)
    expect(r.events).toHaveLength(MAX_EVENTS)
    expect(r.events[0].text).toBe('e20')
    store.addEvent(r.id, 'key sk-abcdef123456 ' + 'x'.repeat(500))
    const last = r.events[r.events.length - 1].text
    expect(last).not.toContain('sk-abcdef123456')
    expect(last.length).toBeLessThanOrEqual(300)
  })

  it('stores a report only up to the size cap', () => {
    const { store } = mk()
    const a = store.createRun('a')
    store.setReport(a.id, '{"ok":true}')
    expect(a.status).toBe('done')
    expect(a.report).toBe('{"ok":true}')
    const b = store.createRun('b')
    store.setReport(b.id, 'x'.repeat(MAX_REPORT_JSON_BYTES + 1))
    expect(b.status).toBe('failed')
    expect(b.report).toBeNull()
    expect(b.error).toMatch(/size cap/)
  })

  it('evicts after the TTL on get and create', () => {
    const { store, clock } = mk({ ttlMs: 1000 })
    const r = store.createRun('s')
    store.setStatus(r.id, 'done') // WR-03: only finished runs are evicted by the TTL
    clock.t += 1001
    expect(store.getRun(r.id)).toBeNull()
    const r2 = store.createRun('s')
    store.setStatus(r2.id, 'failed')
    clock.t += 2000
    store.createRun('s')
    expect(store.getRun(r2.id)).toBeNull()
  })

  it('evicts finished runs beyond the cap oldest-first, never running ones', () => {
    const { store, clock } = mk({ maxRuns: 2 })
    const running = store.createRun('a')
    store.setStatus(running.id, 'running')
    clock.t += 1
    const d1 = store.createRun('b')
    store.setStatus(d1.id, 'done')
    clock.t += 1
    const d2 = store.createRun('c')
    store.setStatus(d2.id, 'done')
    clock.t += 1
    store.createRun('d')
    expect(store.getRun(running.id)).not.toBeNull()
    expect(store.getRun(d1.id)).toBeNull()
  })

  it('single-flight guards', () => {
    const { store } = mk()
    expect(store.tryAcquire('s1')).toBe(true)
    const r = store.createRun('s1')
    expect(store.activeCount()).toBe(1)
    expect(store.activeFor('s1')).toBe(1)
    expect(store.activeFor('s2')).toBe(0)
    expect(store.tryAcquire('s1')).toBe(false)
    expect(store.tryAcquire('s2')).toBe(false)
    store.setStatus(r.id, 'running')
    expect(store.tryAcquire('s2')).toBe(false)
    store.setStatus(r.id, 'done')
    expect(store.tryAcquire('s2')).toBe(true)
  })

  it('publicView hides the session key and internals', () => {
    const { store } = mk()
    const r = store.createRun('secret-session', 2)
    store.setProgress(r.id, { done: 1, total: 2, current: 'T1' })
    store.addEvent(r.id, 'hello')
    const v = store.publicView(r)
    expect(Object.keys(v).sort()).toEqual(['error', 'events', 'progress', 'status'])
    expect(JSON.stringify(v)).not.toContain('secret-session')
    expect(v.progress).toEqual({ done: 1, total: 2, current: 'T1' })
  })
})
