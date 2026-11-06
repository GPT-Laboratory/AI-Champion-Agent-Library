import { describe, expect, it } from 'vitest'
import { uiSpecViewerEnabled } from './flags'
import { specViewerData } from './pageFlags'
import { buildSpecText, tokenizeSpec, SPEC_VIEWER_MAX_BYTES, type SpecRowLike } from './specViewer'

const row: SpecRowLike = {
  slug: 'a',
  title: 'T',
  summary: 'S',
  systemPrompt: 'Use sk-abcdefghijklmnopqrstuvwxyz0123 carefully.\nSecond line: x',
  llmName: 'gpt-4o',
  llmTemperature: 0.2,
  llmMaxTokens: null,
  llmTopP: null,
  toolNames: ['search'],
  inputFields: [{ key: 'k', label: 'k', api_key: 'hunter2hunter2' }],
  requiresHumanApproval: false,
  category: null,
  githubUrl: null,
  maturityStatus: 'beta',
  tags: ['x'],
  customizableFields: null,
  fixedFields: [],
  fixedNote: null,
  specId: null,
}

describe('uiSpecViewerEnabled', () => {
  it('is off by default and for falsy values', () => {
    expect(uiSpecViewerEnabled({})).toBe(false)
    expect(uiSpecViewerEnabled({ UI_SPEC_VIEWER: '0' })).toBe(false)
  })
  it.each(['1', 'true', 'ON', ' yes '])('is on for %j', (v) => {
    expect(uiSpecViewerEnabled({ UI_SPEC_VIEWER: v })).toBe(true)
  })
})

describe('specViewerData', () => {
  it('adds no key when off', () => {
    expect(specViewerData(row, {})).toEqual({})
    expect(Object.keys(specViewerData(row, { UI_SPEC_VIEWER: '0' }))).toEqual([])
  })
  it('adds specViewer when on', () => {
    expect(specViewerData(row, { UI_SPEC_VIEWER: '1' }).specViewer?.text).toContain('slug: a')
  })
})

describe('buildSpecText', () => {
  it('redacts inline tokens and secret-keyed values', () => {
    const { text } = buildSpecText(row)
    expect(text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123')
    expect(text).not.toContain('hunter2hunter2')
    expect(text).toContain('[redacted]')
  })
  it('caps the size on a UTF-8 boundary', () => {
    const big = buildSpecText({ ...row, systemPrompt: 'ä'.repeat(100000) })
    expect(big.truncated).toBe(true)
    expect(Buffer.byteLength(big.text)).toBeLessThanOrEqual(SPEC_VIEWER_MAX_BYTES)
  })
})

describe('tokenizeSpec', () => {
  it('round-trips every line exactly and never emits markup semantics', () => {
    const src = 'a: 1\nb: "<img src=x onerror=alert(1)>"\n# c\nlist:\n  - x: true\n  - null\n  - plain <b>\n'
    const lines = tokenizeSpec(src)
    expect(lines.map((l) => l.map((t) => t.text).join('')).join('\n')).toBe(src.replace(/\n$/, ''))
  })
  it('classifies keys and scalars', () => {
    const [l] = tokenizeSpec('n: 1.5')
    expect(l!.map((t) => t.kind)).toEqual(['key', 'punct', 'text', 'number'])
  })
})
