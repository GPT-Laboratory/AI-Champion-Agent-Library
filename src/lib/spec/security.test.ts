import { describe, expect, it } from 'vitest'
import { capText, redactSecrets, scanSecrets } from './security.js'

describe('scanSecrets', () => {
  it('flags denylisted keys with non-empty string values', () => {
    const found = scanSecrets({ api_key: 'abc', nested: { Authorization: 'x', password: '' }, list: [{ token: 't' }] })
    expect(found).toEqual(['$.api_key', '$.nested.Authorization', '$.list[0].token'])
  })
  it('flags sk- strings under any key', () => {
    expect(scanSecrets({ note: 'sk-abcdefgh123' })).toEqual(['$.note'])
    expect(scanSecrets({ note: 'sk-short' })).toEqual([])
  })
  it('does not flag env-var names', () => {
    expect(scanSecrets({ env_var_names: ['OPENAI_API_KEY'], x: { env_var_names: 'OPENAI_API_KEY' } })).toEqual([])
  })
  it('handles cycles and depth without throwing', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expect(() => scanSecrets(a)).not.toThrow()
    let deep: Record<string, unknown> = { api_key: 'k' }
    for (let i = 0; i < 40; i++) deep = { d: deep }
    expect(scanSecrets(deep)).toEqual([])
  })
})

describe('redactSecrets', () => {
  it('returns a redacted deep copy', () => {
    const src = { api_key: 'abc', ok: 'fine', arr: [{ bearer: 'b' }] }
    const out = redactSecrets(src)
    expect(out).toEqual({ api_key: '[redacted]', ok: 'fine', arr: [{ bearer: '[redacted]' }] })
    expect(src.api_key).toBe('abc')
  })
  it('truncates cyclic and very deep input', () => {
    const a: Record<string, unknown> = { v: 1 }
    a.self = a
    expect((redactSecrets(a) as Record<string, unknown>).self).toBe('[truncated]')
    let deep: Record<string, unknown> = { leaf: 1 }
    for (let i = 0; i < 40; i++) deep = { d: deep }
    expect(() => JSON.stringify(redactSecrets(deep))).not.toThrow()
  })
})

describe('capText', () => {
  it('truncates by utf-8 bytes', () => {
    expect(capText('abc', 10)).toEqual({ text: 'abc', truncated: false })
    expect(capText('abcdef', 3)).toEqual({ text: 'abc', truncated: true })
    const r = capText('aéé', 3) // a=1, é=2 each
    expect(r.truncated).toBe(true)
    expect(r.text).toBe('aé')
  })
})
