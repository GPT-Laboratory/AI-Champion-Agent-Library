import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HANDOFFS, HANDOFF_KEY, HANDOFF_MAX_AGE_MS, openedByHandoff, storeHandoff, takeHandoff, type HandoffPayload } from './handoff'

const DIR = join(process.cwd(), 'data/tryitout-prompts/scope-rule-drafter')
const SAMPLE = readFileSync(join(DIR, 'sample-ebom-input.txt'), 'utf8')
const KEY = readFileSync(join(DIR, 'example-result.md'), 'utf8')

function memStore() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
}
const payload = (over: Partial<HandoffPayload> = {}): HandoffPayload => ({ from: 'a', to: 'b', fileName: 'f.txt', text: 't', note: 'n', at: 1000, ...over })

describe('HANDOFFS', () => {
  it('scope-rule-drafter hands its rules to ifc-ebom-compiler; nothing to hand without a rule', () => {
    const h = HANDOFFS.get('scope-rule-drafter')!
    expect(h.to).toBe('ifc-ebom-compiler')
    const built = h.build(SAMPLE, KEY)!
    expect(built.fileName).toBe('ebom-upload-with-rules.txt')
    expect(built.note).toBe('From the Scope Rule Drafter: 2 rules added to ## RULES of the upload (its sentences removed).')
    expect(built.text).not.toContain('## RULE TEXT')
    expect(built.text).toContain('text:2: type_name = Temporary duct')
    expect(h.build(SAMPLE, '## RULES\nnone\n')).toBeNull()
    // A run with no file: the "upload" is the typed rules, not E-BOM data; nothing to hand over.
    expect(h.build('Exclude all sprinkler elements.', KEY)).toBeNull()
    expect(HANDOFFS.get('ifc-ebom-compiler')).toBeUndefined()
  })
})

describe('store and take', () => {
  it('only the receiving agent takes it, once', () => {
    const s = memStore()
    expect(storeHandoff(payload(), s)).toBe(true)
    expect(takeHandoff('other', s, 1000)).toBeNull()
    expect(s.m.has(HANDOFF_KEY)).toBe(true)
    expect(takeHandoff('b', s, 1000)).toEqual(payload())
    expect(takeHandoff('b', s, 1000)).toBeNull()
  })

  it('only a page opened by the hand-over button takes it; otherwise this agent\'s hand-over is discarded', () => {
    expect(openedByHandoff('?tryout=1&handoff=1')).toBe(true)
    expect(openedByHandoff('?tryout=1')).toBe(false)
    expect(openedByHandoff('?handoff=yes')).toBe(false)
    const s = memStore()
    storeHandoff(payload(), s)
    expect(takeHandoff('other', s, 1000, false)).toBeNull()
    expect(s.m.has(HANDOFF_KEY)).toBe(true) // another agent's hand-over stays
    expect(takeHandoff('b', s, 1000, false)).toBeNull()
    expect(s.m.has(HANDOFF_KEY)).toBe(false) // this agent's is dropped, never shown later
  })

  it('stale, broken or oversized hand-overs are dropped; no storage means no hand-over', () => {
    const s = memStore()
    storeHandoff(payload(), s)
    expect(takeHandoff('b', s, 1000 + HANDOFF_MAX_AGE_MS + 1)).toBeNull()
    s.setItem(HANDOFF_KEY, '{not json')
    expect(takeHandoff('b', s)).toBeNull()
    expect(s.m.has(HANDOFF_KEY)).toBe(false)
    s.setItem(HANDOFF_KEY, JSON.stringify({ ...payload(), text: 5 }))
    expect(takeHandoff('b', s, 1000)).toBeNull()
    expect(storeHandoff(payload({ text: 'x'.repeat(200 * 1024 + 1) }), s)).toBe(false)
    expect(storeHandoff(payload(), null)).toBe(false)
    expect(takeHandoff('b', null)).toBeNull()
  })
})
