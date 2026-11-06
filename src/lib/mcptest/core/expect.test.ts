import { describe, it, expect } from 'vitest'
import { evaluateExpect } from './expect'
import type { ToolOutcome } from './types'

const res = (text: string, isError = false, structured?: unknown): ToolOutcome => ({
  kind: 'result',
  isError,
  text,
  structured,
  content: []
})
const item = res(JSON.stringify({ items: [{ id: 'A-1', name: 'Widget', price: 3 }] }))

describe('evaluateExpect', () => {
  it('field_value / field_present / fields_present', () => {
    expect(evaluateExpect({ field_value: { name: 'widget' } }, item).ok).toBe(true)
    expect(evaluateExpect({ field_value: { name: 'Gadget' } }, item).ok).toBe(false)
    expect(evaluateExpect({ field_present: 'price' }, item).ok).toBe(true)
    expect(evaluateExpect({ fields_present: ['id', 'nope'] }, item).ok).toBe(false)
  })
  it('field_value uses identity aliases for id keys', () => {
    const o = res(JSON.stringify({ sku: 'A-1' }))
    expect(evaluateExpect({ field_value: { id: 'A-1' } }, o, { idKeys: ['id', 'sku'] }).ok).toBe(true)
  })
  it('no_error and no_leak', () => {
    expect(evaluateExpect({ no_error: true }, item).ok).toBe(true)
    expect(evaluateExpect({ no_error: true }, res('boom', true)).ok).toBe(false)
    expect(evaluateExpect({ no_error: true }, { kind: 'rpc_error', code: -32602, message: 'bad' }).ok).toBe(false)
    expect(evaluateExpect({ no_error: true }, { kind: 'transport_error', message: 'x' }).ok).toBe(false)
    const l = evaluateExpect({ no_leak: true }, res('Traceback (most recent call last)'))
    expect(l.ok).toBe(false)
    expect(l.leak).toBe('substring:Traceback (most recent call last)')
  })
  describe('clean_not_found is strict', () => {
    it('passes on isError without leak', () => {
      expect(evaluateExpect({ clean_not_found: true }, res('lookup failed', true)).ok).toBe(true)
    })
    it('passes on explicit signal text', () => {
      expect(evaluateExpect({ clean_not_found: true }, res('{"ok":false,"kind":"not_found","message":"Item not found"}')).ok).toBe(true)
    })
    it('deliberate deviation: lenient source pass (non-error, no signal) now FAILS', () => {
      expect(evaluateExpect({ clean_not_found: true }, res('All good, here you go')).ok).toBe(false)
    })
    it('fails on leak or returned item', () => {
      expect(evaluateExpect({ clean_not_found: true }, res('not found httpx.ReadError', true)).ok).toBe(false)
      expect(evaluateExpect({ clean_not_found: true }, res('{"id":"A-1","name":"x","note":"not found"}')).ok).toBe(false)
    })
  })
  it('empty_with_message', () => {
    expect(evaluateExpect({ empty_with_message: true }, res('{"items":[],"message":"No results"}')).ok).toBe(true)
    expect(evaluateExpect({ empty_with_message: true }, res('{"items":[]}')).ok).toBe(false)
    expect(evaluateExpect({ empty_with_message: true }, item).ok).toBe(false)
  })
  it('max_items and max_fields', () => {
    expect(evaluateExpect({ max_items: 1 }, item).ok).toBe(true)
    expect(evaluateExpect({ max_items: 0 }, item).ok).toBe(false)
    expect(evaluateExpect({ max_fields: 3 }, item).ok).toBe(true)
    expect(evaluateExpect({ max_fields: 2 }, item).ok).toBe(false)
  })
  it('status_category', () => {
    expect(evaluateExpect({ status_category: 'auth' }, res('Unauthorized: bad api key', true)).ok).toBe(true)
    expect(evaluateExpect({ status_category: 'not_found' }, res('{"kind":"not_found"}')).ok).toBe(true)
    expect(evaluateExpect({ status_category: 'upstream' }, res('fine')).ok).toBe(false)
    expect(evaluateExpect({ status_category: 404 }, res('HTTP 404')).ok).toBe(true)
  })
  it('error outcomes never auto-pass data expects', () => {
    const t: ToolOutcome = { kind: 'transport_error', message: 'closed' }
    expect(evaluateExpect({ field_present: 'id' }, t).ok).toBe(false)
    expect(evaluateExpect({ max_items: 5 }, t).ok).toBe(false)
    expect(evaluateExpect({ no_leak: true }, t).ok).toBe(true)
    expect(evaluateExpect({ no_leak: true }, { kind: 'transport_error', message: 'ConnectionError: x' }).ok).toBe(false)
  })
  it('reason is capped at 200 chars', () => {
    const long = 'k'.repeat(500)
    expect(evaluateExpect({ field_present: long }, item).reason.length).toBeLessThanOrEqual(200)
  })
})
