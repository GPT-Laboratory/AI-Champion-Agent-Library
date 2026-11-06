import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runPipeline } from './pipeline.js'

const fx = (n: string) => readFileSync(new URL(`./testing/fixtures/${n}`, import.meta.url), 'utf8')
const NEEDED = ['server.py', 'test_server.py', 'requirements.txt', 'README.generated.md', 'report.json']

describe('runPipeline', () => {
  for (const [name, file, adapter] of [
    ['openapi', 'acme-openapi.yaml', undefined],
    ['catalog', 'acme-catalog-header.csv', undefined],
    ['sql', 'acme-schema.sql', undefined],
    ['openapi forced', 'acme-openapi.yaml', 'openapi'],
  ] as const) {
    it(`generates from ${name}`, () => {
      const r = runPipeline(fx(file), { adapterId: adapter })
      expect(r.ok).toBe(true)
      if (r.ok) {
        const paths = r.files.map((f) => f.path)
        for (const n of NEEDED) expect(paths).toContain(n)
        expect(r.serverName).toMatch(/^[a-z0-9_]+$/)
      }
    })
  }

  it('does not guess when the forced adapter is wrong', () => {
    const r = runPipeline(fx('acme-schema.sql'), { adapterId: 'openapi' })
    expect(r.ok).toBe(false)
  })

  it('rejects an unknown adapter and unrecognized input', () => {
    expect(runPipeline(fx('acme-openapi.yaml'), { adapterId: 'nope' }).ok).toBe(false)
    expect(runPipeline('hello world, nothing here').ok).toBe(false)
  })

  it('rejects credentials without echoing them', () => {
    const secret = ['sk', 'abcdefghijklmnop1234567890'].join('-')
    const r = runPipeline(`${fx('acme-openapi.yaml')}\napi_key: ${secret}\n`)
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain(secret)
    if (!r.ok) expect(r.gaps.some((g) => g.code === 'credential-rejected')).toBe(true)
  })

  it('rejects oversize input', () => {
    const r = runPipeline('a'.repeat(262145))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.gaps[0].code).toBe('input-too-large')
  })

  it('never throws on non-string input', () => {
    // @ts-expect-error deliberate bad input
    expect(runPipeline(undefined).ok).toBe(false)
  })
})
