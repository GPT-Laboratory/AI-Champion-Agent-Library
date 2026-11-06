import { describe, expect, it, vi } from 'vitest'
import { scanForCredentials, toGaps } from './credentials'
import { parseInput } from './registry'
import type { InputAdapter } from './types'

// Secret-shaped literals are built at runtime so none is committed as text.
const long = 'a1B2'.repeat(6)
const sk = 'sk-' + 'a'.repeat(20)
const aws = 'AKI' + 'A' + 'B'.repeat(16)
const ghp = 'ghp' + '_' + 'c'.repeat(30)
const pem = '-----BEGIN ' + 'RSA PRIVATE KEY-----'

const flagged: Array<[string, string]> = [
  ['sk token', `note: ${sk}`],
  ['bearer', `curl -H "Bearer ${long}"`],
  ['authorization header', `Authorization: Basic ${long}`],
  ['json api key', `{"api_key": "${long}"}`],
  ['yaml token', `token: ${long}`],
  ['query string', `GET /items?apiKey=${long}`],
  ['env line', `export SERVICE_KEY=${long}`],
  ['env password', `DB_PASSWORD=${long}`],
  ['aws', `id = ${aws}`],
  ['github token', `t ${ghp}`],
  ['github pat', `t ${'github' + '_pat_'}${'d'.repeat(30)}`],
  ['pem', pem],
]

const clean: Array<[string, string]> = [
  ['securitySchemes yaml', 'securitySchemes:\n  apiKeyAuth:\n    type: apiKey\n    in: header\n    name: X-Api-Key'],
  ['securitySchemes json', '{"securitySchemes":{"apiKey":{"type":"apiKey","in":"header","name":"X-Api-Key"}}}'],
  ['authorization param', '{"name": "Authorization", "in": "header"}'],
  ['env placeholder', 'token: ${SERVICE_API_KEY}'],
  ['angle placeholder', 'api_key: <SERVICE_API_KEY>'],
  ['dollar placeholder', 'secret=$SERVICE_SECRET'],
  ['your key', 'api_key: YOUR_API_KEY_GOES_HERE'],
  ['changeme', 'password: changeme-please'],
  ['example', 'token: example-token-value'],
  ['bearer placeholder', 'Authorization: Bearer ${SERVICE_TOKEN}'],
  ['ddl column', 'CREATE TABLE users (id INTEGER PRIMARY KEY, api_key VARCHAR(64) NOT NULL);'],
  ['token_count', 'token_count: 1234567890'],
  ['env name value', 'api_key: SERVICE_API_KEY'],
  ['bearer scheme', 'scheme: bearer\nbearerFormat: JWT'],
]

describe('scanForCredentials', () => {
  it.each(flagged)('flags %s', (_n, text) => {
    expect(scanForCredentials(text).length).toBeGreaterThan(0)
  })
  it.each(clean)('does not flag %s', (_n, text) => {
    expect(scanForCredentials(text)).toEqual([])
  })
  it('reports line numbers and kinds only, never the value', () => {
    const text = `ok: 1\napi_key: ${long}\nother: ${sk}\n${pem}`
    const findings = scanForCredentials(text)
    expect(findings.map((f) => f.line)).toEqual(expect.arrayContaining([2, 3, 4]))
    const gaps = toGaps(findings)
    const dump = JSON.stringify([findings, gaps])
    for (const secret of [long, sk, 'a'.repeat(20), 'PRIVATE KEY-----']) {
      expect(dump).not.toContain(secret)
    }
    expect(gaps.every((g) => g.code === 'credential-rejected' && g.severity === 'error')).toBe(true)
    expect(gaps[0].message).toMatch(/env-var placeholder/)
  })
  it('is bounded', () => {
    const many = Array.from({ length: 200 }, () => `token: ${long}`).join('\n')
    expect(scanForCredentials(many).length).toBeLessThanOrEqual(20)
  })
})

describe('registry credential gate', () => {
  it('rejects before parse is called', () => {
    const parse = vi.fn()
    const adapter: InputAdapter = { id: 'fake', label: 'Fake', detect: () => 1, parse }
    const r = parseInput({ text: `api_key: ${long}` }, { adapters: [adapter] })
    expect(r).toMatchObject({ ok: false, gaps: [{ code: 'credential-rejected' }] })
    expect(parse).not.toHaveBeenCalled()
    expect(JSON.stringify(r)).not.toContain(long)
  })
})
