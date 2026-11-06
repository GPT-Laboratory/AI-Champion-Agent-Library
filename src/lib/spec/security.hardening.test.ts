// Phase 13 review fixes: CR-01 (key-path aware, inline token shapes, truncation reporting) and WR-06 (setOwn).
import { describe, expect, it } from 'vitest'
import { redactSecrets, redactText, scanSecrets, scanTruncated, setOwn } from './security.js'

describe('CR-01 key-path aware redaction', () => {
  it('redacts every descendant of a denylisted key, not only the direct value', () => {
    const src = { secrets: { db: 'hunter2', list: ['a', { deep: 'b' }] }, auth: { value: 'topsecret' }, ok: 'fine' }
    expect(scanSecrets(src)).toEqual(['$.secrets.db', '$.secrets.list[0]', '$.secrets.list[1].deep', '$.auth.value'])
    expect(redactSecrets(src)).toEqual({
      secrets: { db: '[redacted]', list: ['[redacted]', { deep: '[redacted]' }] },
      auth: { value: '[redacted]' },
      ok: 'fine',
    })
  })

  it.each(['credentials', 'private_key', 'private-key', 'passwd', 'pwd', 'cookie', 'session', 'auth', 'client_secret'])(
    'treats %s as a secret key',
    (key) => {
      expect(scanSecrets({ [key]: 'value-1' })).toEqual([`$.${key}`])
      expect(redactSecrets({ [key]: 'value-1' })).toEqual({ [key]: '[redacted]' })
    },
  )

  it('does not treat author or authority as the auth key', () => {
    expect(scanSecrets({ author: 'Ville', authority: 'x', authors: ['a'] })).toEqual([])
  })

  it('leaves numbers and booleans under a secret key alone', () => {
    expect(redactSecrets({ token: { count: 3, on: true } })).toEqual({ token: { count: 3, on: true } })
  })
})

describe('CR-01 inline token shapes', () => {
  const samples: Array<[string, string]> = [
    ['github', 'use ghp_abcdefghijklmnopqrstuvwxyz0123456789 here'],
    ['slack', 'xoxb-123456789012-abcdefghij is the bot'],
    ['aws', 'key AKIAABCDEFGHIJKLMNOP end'],
    ['bearer', 'send Authorization: Bearer abcdefghijklmnopqrstuvwxyz.123'],
    ['openai', 'key sk-abcdefghijklmnopqrstuvwx here'],
    ['pem', 'x\n-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY-----\ny'],
  ]
  it.each(samples)('redacts %s tokens inside free text', (_n, text) => {
    const out = redactText(text)
    expect(out).toContain('[redacted]')
    expect(out).not.toMatch(/ghp_abc|xoxb-1234|AKIAABCD|abcdefghijklmnopqrstuvwxyz\.123|sk-abcdef|MIIBOg/)
    expect(scanSecrets({ note: text })).toEqual(['$.note'])
    expect((redactSecrets({ note: text }) as { note: string }).note).toBe(out)
  })

  it('is idempotent and leaves ordinary prose alone', () => {
    const once = redactText('token ghp_abcdefghijklmnopqrstuvwxyz0123456789 x')
    expect(redactText(once)).toBe(once)
    expect(redactText('the bearer of this message uses a token')).toBe('the bearer of this message uses a token')
  })

  it('does not re-flag a value that is already redacted', () => {
    expect(scanSecrets({ api_key: '[redacted]' })).toEqual([])
  })
})

describe('CR-01 depth overflow is reported', () => {
  it('reports truncation instead of silently ignoring deep values', () => {
    let deep: Record<string, unknown> = { api_key: 'k' }
    for (let i = 0; i < 40; i++) deep = { d: deep }
    expect(scanTruncated(deep).length).toBeGreaterThan(0)
    expect(JSON.stringify(redactSecrets(deep))).not.toContain('"k"')
    expect(scanTruncated({ a: { b: 1 } })).toEqual([])
  })
})

describe('WR-06 setOwn', () => {
  it('drops __proto__ and stores constructor as plain data', () => {
    const o: Record<string, unknown> = {}
    setOwn(o, '__proto__', { polluted: true })
    setOwn(o, 'constructor', 7)
    expect(Object.getPrototypeOf(o)).toBe(Object.prototype)
    expect(Object.keys(o)).toEqual(['constructor'])
    expect(JSON.parse(JSON.stringify(o))).toEqual({ constructor: 7 })
  })
})
