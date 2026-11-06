// Review fixes CR-01 (scanner CPU time) and WR-03 (scanner blind spots). Secret-shaped literals are
// assembled at runtime so no deliberate secret is committed as text.
import { describe, expect, it } from 'vitest'
import { scanForCredentials, SCAN_WINDOW } from './credentials'
import { parseInput } from './registry'

const j = (...parts: string[]) => parts.join('')
const long = 'a1B2'.repeat(6)
const kinds = (t: string) => scanForCredentials(t).map((f) => f.kind)

/** Wall-clock bound far above the linear cost and far below the old quadratic cost (minutes). */
const BOUND_MS = 1500

function timed(text: string): number {
  const t0 = performance.now()
  scanForCredentials(text)
  return performance.now() - t0
}

describe('CR-01: scanner time is linear in the input', () => {
  const N = 250_000
  const shapes: Array<[string, string]> = [
    ['identifier run', 'a'.repeat(N)],
    ['repeated key word', 'token'.repeat(N / 5)],
    ['repeated key assignment', 'token='.repeat(N / 6)],
    ['repeated quoted assignment', 'password="'.repeat(N / 10)],
    ['repeated bearer', 'bearer '.repeat(N / 7)],
    ['repeated jwt prefix', 'eyJ'.repeat(N / 3)],
    ['repeated sk prefix', 'sk-'.repeat(N / 3)],
    ['repeated url separator', '://'.repeat(N / 3)],
    ['repeated userinfo candidate', 'a://b:'.repeat(N / 6)],
    ['key word then spaces', 'token' + ' '.repeat(N)],
    ['hex dump', 'deadbeef'.repeat(N / 8)],
    ['escape run', 'token=' + '\\'.repeat(N)],
    ['quote run', 'token="' + "'".repeat(N)],
  ]
  it.each(shapes)('%s on one 250 000 character line stays fast', (_name, text) => {
    expect(timed(text)).toBeLessThan(BOUND_MS)
  })
  it('the same shapes spread over many lines stay fast', () => {
    const text = shapes.map(([, s]) => s.slice(0, 4000)).join('\n').repeat(8)
    expect(timed(text)).toBeLessThan(BOUND_MS)
  })
  it('a spec padded to the size cap through the registry stays fast and is not rejected', () => {
    const t0 = performance.now()
    const r = parseInput({ text: 'a'.repeat(250_000) })
    expect(performance.now() - t0).toBeLessThan(BOUND_MS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.gaps.map((g) => g.code)).not.toContain('credential-rejected')
  })
  it('a secret far beyond the first window of a very long line is still found', () => {
    const padding = 'x '.repeat(SCAN_WINDOW * 3)
    const text = `{"a": "${padding}", "api_key": "${long}"}`
    expect(text.length).toBeGreaterThan(SCAN_WINDOW * 5)
    expect(kinds(text)).toContain('key-literal')
  })
  it('a secret that straddles a window boundary is still found', () => {
    const lead = 'x'.repeat(SCAN_WINDOW - 600)
    expect(kinds(`${lead}\u0020password: ${long}`)).toContain('key-literal')
  })
})

describe('WR-03: formerly missed credential shapes are flagged', () => {
  const flagged: Array<[string, string]> = [
    ['secret_key', `secret_key: "${long}"`],
    ['passwd', `passwd: "${long}"`],
    ['client secret', `client_secret = ${long}`],
    ['passphrase', `passphrase: ${long}`],
    ['private key value', `private_key: ${long}`],
    ['access key', `aws_access_key=${long}`],
    ['password with spaces, quoted', 'password: "my secret pass phrase"'],
    ['password with a hash sign', 'password=ab#cdefghijk'],
    ['url userinfo https', 'see https://admin:Sup3rS3cret@host/'],
    ['url userinfo db', 'postgres://user:pw@host/db'],
    ['url with a long token as user', 'https://' + 'Zk3'.repeat(10) + '@host/repo'],
    ['jwt', j('eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'abcDEF123_-xyz')],
    ['payment key live', j('sk', '_live_', 'a1B2c3D4e5F6g7H8i9J0')],
    ['payment key test', j('sk', '_test_', 'a1B2c3D4e5F6g7H8i9J0')],
    ['slack token', j('xox', 'b-', '1234567890-abcdefghij')],
    ['google key', j('AI', 'za', 'A'.repeat(35))],
    ['gitlab token', j('gl', 'pat-', 'q'.repeat(20))],
    ['github server token', j('gh', 's_', 'c'.repeat(30))],
    ['aws temporary key', j('AS', 'IA', 'B'.repeat(16))],
    ['all-caps value is not an env var name', `SECRET=${'KJHGFDSAQWERTYUIOP'}`],
    ['placeholder word only as a substring', 'password: Xexample9812kQ'],
    ['escaped json inside a string', `{"x": "{\\"api_key\\": \\"${long}\\"}"}`],
  ]
  it.each(flagged)('flags %s', (_n, text) => {
    expect(scanForCredentials(text).length).toBeGreaterThan(0)
  })

  const clean: Array<[string, string]> = [
    ['env var name with underscore', 'password: SERVICE_DB_PASSWORD'],
    ['placeholder url userinfo', 'postgres://user:${DB_PASSWORD}@host/db'],
    ['angle placeholder url', 'postgres://user:<password>@host/db'],
    ['url without userinfo', 'https://host.example/path?x=1'],
    ['email address', 'contact: someone@host.example'],
    ['task word', 'task-management-system-with-a-long-name'],
    ['token_count', 'token_count: 1234567890'],
    ['pwd in a word', 'cpwd: /srv/something/long'],
    ['short jwt-like text', 'eyJ.a.b'],
    ['ddl column named secret', 'CREATE TABLE t (secret TEXT, token TEXT, password VARCHAR(40));'],
    ['prose about a key', 'Use your API key in the header to authenticate requests.'],
  ]
  it.each(clean)('does not flag %s', (_n, text) => {
    expect(scanForCredentials(text)).toEqual([])
  })

  it('never reports the matched text', () => {
    const text = `postgres://user:Sup3rS3cretPw@host/db\n${j('eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'abcDEF123_-xyz')}`
    const dump = JSON.stringify(scanForCredentials(text))
    expect(dump).not.toContain('Sup3rS3cretPw')
    expect(dump).not.toContain('hbGciOiJIUzI1NiJ9')
  })
  it('reports each finding on its own line', () => {
    const f = scanForCredentials(`ok: 1\npostgres://user:pw@host/db\nok: 2\nsecret_key: ${long}`)
    expect(f.map((x) => [x.line, x.kind])).toEqual([
      [2, 'url-credentials'],
      [4, 'key-literal'],
    ])
  })
})
