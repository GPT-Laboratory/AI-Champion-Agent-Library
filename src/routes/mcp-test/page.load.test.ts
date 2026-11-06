// Node environment: the load imports the fake servers, which need file URLs.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { load } from './+page.server'

afterEach(() => vi.unstubAllEnvs())

const callLoad = () => (load as unknown as (e: unknown) => unknown)({})

describe('/mcp-test load', () => {
  it('answers 404 when MCP_TESTER is off', () => {
    vi.stubEnv('MCP_TESTER', '')
    let thrown: { status?: number } | undefined
    try {
      callLoad()
    } catch (e) {
      thrown = e as { status?: number }
    }
    expect(thrown?.status).toBe(404)
  })

  it('returns subjects and the 12 cases when the flag is on', () => {
    vi.stubEnv('MCP_TESTER', '1')
    const data = callLoad() as {
      subjects: { id: string; runnable: boolean; note?: string }[]
      cases: { id: string; tier: number; badge: string }[]
    }
    expect(data.cases).toHaveLength(12)
    expect(new Set(data.cases.map((c) => c.badge))).toEqual(
      new Set(['implemented', 'synthetic', 'generator-only', 'needs real runtime'])
    )
    const ids = data.subjects.map((s) => s.id)
    expect(ids).toContain('fake:good')
    expect(ids).toContain('generator:openapi')
    const blocked = data.subjects.filter((s) => !s.runnable)
    expect(blocked.length).toBeGreaterThan(0)
    for (const s of blocked) expect(s.note).toBeTruthy()
    const json = JSON.stringify(data)
    expect(json).not.toContain(process.cwd())
    expect(json).not.toMatch(/process\.env|MCP_TESTER/)
  })
})

describe('/mcp-test references', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (/\.(svelte|ts)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p)
    }
    return out
  }
  it('is linked only from the Customize menu', () => {
    const files = [...walk(join(process.cwd(), 'src/routes')), ...walk(join(process.cwd(), 'src/lib/components'))]
    const hits = files
      .filter((f) => /['"`]\/mcp-test['"`]/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(process.cwd().length + 1))
    expect(hits).toEqual(['src/lib/components/CustomizeMenu.svelte'])
  })
})
