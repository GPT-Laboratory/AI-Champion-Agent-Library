// CR-34: one environment-file rule, not broader than documented and not missing `prod.env`.
import { describe, expect, it } from 'vitest'
import { isEnvFileName } from './credentials.js'
import { buildContextPack } from './proposals/contextPack.js'
import { fixtureText } from './proposals/testkit.js'

describe('isEnvFileName (CR-34)', () => {
  it.each(['.env', '.env.local', '.ENV', '.envrc', 'prod.env', 'secrets.env', 'env', 'env.production', '/a/b/.env', 'a\\b\\.env'])('refuses %s', (n) => expect(isEnvFileName(n)).toBe(true))
  it.each(['environment.md', 'envelope.json', 'env_vars.md', 'environments.yaml', 'spec.yaml', 'dev-env-notes.md', 'envs.csv'])('allows %s', (n) => expect(isEnvFileName(n)).toBe(false))
})

describe('context pack input names (CR-34)', () => {
  const source = { name: 'acme-openapi.yaml', text: fixtureText('acme-openapi.yaml') }
  it('accepts a doc named environment.md and refuses prod.env', () => {
    expect(buildContextPack({ source, docs: [{ name: 'environment.md', text: '# Environments\nStaging and production.' }] }).ok).toBe(true)
    const r = buildContextPack({ source, docs: [{ name: 'prod.env', text: 'x' }] })
    expect(r.ok).toBe(false)
  })
})
