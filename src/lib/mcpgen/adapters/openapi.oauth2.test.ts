// OAuth2 and OpenID Connect (D-521): no flow is implemented; the generated server reads a bearer access token from
// <PREFIX>_ACCESS_TOKEN and sends `Authorization: Bearer`. The credential scanner is unchanged.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseInput } from '../registry'
import { generate } from '../generate'
import { runPipeline } from '../pipeline'

const oauth2 = readFileSync(fileURLToPath(new URL('../testing/fixtures/acme-oauth2.yaml', import.meta.url)), 'utf8')

function ok(text: string) {
  const r = parseInput({ text })
  if (!r.ok) throw new Error(JSON.stringify(r.gaps))
  return r
}
const withScheme = (scheme: string, security = 'security:\n  - S: []\n') =>
  `openapi: 3.0.3\ninfo: { title: Acme Tok, version: "1" }\n${security}paths:\n  /things:\n    get:\n      operationId: listThings\n      responses:\n        "200":\n          description: ok\n          content:\n            application/json:\n              schema:\n                type: array\n                items:\n                  type: object\n                  properties:\n                    thing_id: { type: string }\ncomponents:\n  securitySchemes:\n    S:\n${scheme}`

describe('oauth2 in OpenAPI 3.x', () => {
  const r = ok(oauth2)
  it('becomes a bearer access token read from <PREFIX>_ACCESS_TOKEN', () => {
    expect(r.model.auth).toEqual({ scheme: 'bearer', envVar: 'ACME_LEDGER_ACCESS_TOKEN', oauth2: true })
  })
  it('reports oauth2-flow-not-implemented as a warning, once', () => {
    const g = r.gaps.filter((x) => x.code === 'oauth2-flow-not-implemented')
    expect(g).toHaveLength(1)
    expect(g[0].severity).toBe('warn')
  })
  it('openIdConnect is handled the same way', () => {
    const o = ok(withScheme('      type: openIdConnect\n      openIdConnectUrl: https://auth.acme.example/.well-known/openid-configuration\n'))
    expect(o.model.auth).toMatchObject({ scheme: 'bearer', envVar: 'ACME_TOK_ACCESS_TOKEN', oauth2: true })
    expect(o.gaps.map((g) => g.code)).toContain('oauth2-flow-not-implemented')
  })
  it('an API key scheme listed first (by name) wins and the choice is reported', () => {
    const t = `${withScheme('      type: oauth2\n      flows: {}\n', 'security:\n  - S: []\n  - A: []\n')}    A:\n      type: apiKey\n      in: header\n      name: X-Acme-Key\n`
    const o = ok(t)
    expect(o.model.auth.scheme).toBe('apiKeyHeader')
    expect(o.gaps.map((g) => g.code)).toContain('auth-multiple')
  })
  it('a public API (empty security) sends no token and raises no oauth2 gap', () => {
    const o = ok(withScheme('      type: oauth2\n      flows: {}\n', 'security: []\n'))
    expect(o.model.auth.scheme).toBe('none')
    expect(o.gaps.map((g) => g.code)).not.toContain('oauth2-flow-not-implemented')
  })
})

describe('generated server for an oauth2 API', () => {
  const server = generate(ok(oauth2).model, {}).files.find((f) => f.path === 'server.py')!.content
  it('reads the token from the environment and sends it as a bearer token', () => {
    expect(server).toContain('AUTH_ENV = "ACME_LEDGER_ACCESS_TOKEN"')
    expect(server).toContain('headers["Authorization"] = "Bearer " + key')
    expect(server).toContain('OAuth2 access token obtained by you; never stored')
  })
  it('implements no flow: no token endpoint, no authorization url, no client credentials', () => {
    expect(server).not.toMatch(/auth\.acme\.example|authorize|tokenUrl|client_id|client_secret|refresh_token|grant_type/)
  })
  it('lists the variable in the report and the README with the OAuth2 purpose', () => {
    const r = runPipeline(oauth2)
    if (!r.ok) throw new Error('must generate')
    expect(r.report.envVars).toContainEqual({ name: 'ACME_LEDGER_ACCESS_TOKEN', purpose: 'OAuth2 access token obtained by you; never stored' })
    expect(r.files.find((f) => f.path === 'README.generated.md')!.content).toContain('OAuth2 access token obtained by you; never stored')
    expect(r.report.gaps.map((g) => g.code)).toContain('oauth2-flow-not-implemented')
  })
  it('an API key source keeps the unchanged wording', () => {
    const t = withScheme('      type: apiKey\n      in: header\n      name: X-Acme-Key\n')
    const s = generate(ok(t).model, {}).files.find((f) => f.path === 'server.py')!.content
    expect(s).toContain('API key for the upstream service')
    expect(s).not.toContain('OAuth2')
  })
})

describe('credentials in an oauth2 document', () => {
  it('a real-looking token in an example is rejected by the scanner and never echoed', () => {
    const literal = ['eyJ', 'hbGciOiJIUzI1NiJ9', 'abcdefghijklmnopqrstuvwxyz0123456789ABCD'].join('')
    const text = `${oauth2}\nx-example:\n  Authorization: Bearer ${literal}\n`
    const out = parseInput({ text })
    expect(out.ok).toBe(false)
    expect(out.gaps.map((g) => g.code)).toContain('credential-rejected')
    expect(JSON.stringify(out)).not.toContain(literal)
  })
  it('a client secret in an OAuth2 flow is rejected', () => {
    const literal = ['s3cr3t', 'Value', '0123456789abcdef'].join('-')
    const out = parseInput({ text: oauth2.replace('flows:', `x-client:\n      client_secret: ${literal}\n      flows:`) })
    expect(out.ok).toBe(false)
    expect(JSON.stringify(out)).not.toContain(literal)
  })
})
