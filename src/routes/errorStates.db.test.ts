// E6: error and empty states against a REAL temporary SQLite file (no db mocks), flags off and on.
import { describe, it, expect, vi, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DDL = `CREATE TABLE agents (slug text primary key, title text not null, summary text not null default '', system_prompt text not null, llm_name text not null, llm_temperature real, llm_max_tokens integer, llm_top_p real, tool_names text not null default '[]', input_schema text not null default '[]', requires_human_approval integer not null default 0, category text, github_url text, link_label text, maturity_status text not null default 'experimental', tags text not null default '[]', customizable_fields text, fixed_note text, fixed_fields text not null default '[]', spec_id text, try_it_out_mode text not null default 'none', try_it_out_url text, try_it_out_task_template text, last_ingested_at text not null default 'x')`

const FLAGS = ['AGENT_KINDS', 'AGENT_COMPARE', 'UI_SPEC_VIEWER', 'MCP_GENERATOR', 'MCP_TESTER', 'UI_DARK_MODE']

function boot(setup?: (d: Database.Database) => void, flags: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'e6-'))
  const p = join(dir, 'c.db')
  const d = new Database(p)
  setup?.(d)
  d.close()
  vi.resetModules()
  vi.stubEnv('CATALOG_DB_PATH', p)
  vi.stubEnv('SEARCH_EMBEDDINGS', 'off')
  for (const f of FLAGS) vi.stubEnv(f, flags[f] ?? '')
  return p
}

afterEach(() => vi.unstubAllEnvs())

type Fn = (e: unknown) => Promise<any>
const catalog = async (qs = '') => ((await import('./catalog/+page.server')).load as unknown as Fn)({ url: new URL('http://x/catalog' + qs) })
const detail = async (slug: string) =>
  ((await import('./agents/[slug]/+page.server')).load as unknown as Fn)({
    params: { slug },
    url: new URL('http://x/agents/' + slug),
    locals: {},
    cookies: { get: () => undefined },
  })
const compare = async (qs: string) => ((await import('./compare/+page.server')).load as unknown as Fn)({ url: new URL('http://x/compare' + qs) })
const status = async (p: Promise<unknown>) => {
  try {
    await p
    return 200
  } catch (e) {
    return (e as { status?: number }).status ?? 'crash'
  }
}

const insertBad = (d: Database.Database) => {
  d.exec(DDL)
  d.prepare(
    `insert into agents (slug,title,system_prompt,llm_name,tags,tool_names,input_schema,fixed_fields,customizable_fields) values ('bad','Bad','p','m','{oops','nope','[[','7','"str"')`
  ).run()
  d.prepare(
    `insert into agents (slug,title,system_prompt,llm_name,tags,tool_names,input_schema) values ('odd','Odd','p','m','"x"','[1,null,"ok"]','{"a":1}')`
  ).run()
}

for (const [label, flags] of [
  ['flags off', {}],
  ['all key flags on', Object.fromEntries(FLAGS.map((f) => [f, '1']))],
] as const) {
  describe(`E6 db states (${label})`, () => {
    const kindsOn = label !== 'flags off'

    it('database file with NO tables: catalog is a friendly empty page, not a 500 (D-401)', async () => {
      boot(undefined, flags)
      const d = await catalog()
      expect(d.agents).toEqual([])
      expect(d.total).toBe(0)
      expect(d.totalPages).toBe(0)
      expect(d.page).toBe(1)
      expect(d.categories).toEqual([])
      expect(d.filters.q).toBeNull()
      expect('kinds' in d).toBe(kindsOn)
    })

    it('no tables + search / filters / bad params still render empty (D-401)', async () => {
      boot(undefined, flags)
      for (const qs of ['?q=hello', '?page=abc', '?page=-5', '?page=99999999999999999999', '?kind=nope', '?category=x&llm=y&maturity=z', `?q=${'a'.repeat(5000)}`]) {
        const d = await catalog(qs)
        expect(d.agents, qs).toEqual([])
        expect(d.total).toBe(0)
      }
    })

    it('no tables: detail answers 404 and compare lists every slug as unknown (D-401)', async () => {
      boot(undefined, { ...flags, AGENT_COMPARE: '1' })
      expect(await status(detail('anything'))).toBe(404)
      const c = await compare('?agents=a&agents=b')
      expect(c.agents).toEqual([])
      expect(c.unknown).toEqual(['a', 'b'])
    })

    it('empty agents table: catalog and unknown slug behave', async () => {
      boot((d) => d.exec(DDL), flags)
      const d = await catalog()
      expect(d.total).toBe(0)
      expect(d.agents).toEqual([])
      expect(await status(detail('nope'))).toBe(404)
      expect(await status(detail('../../etc/passwd'))).toBe(404)
      expect(await status(detail('%00'))).toBe(404)
      expect(await status(detail('a'.repeat(100_000)))).toBe(404)
    })

    it('corrupt JSON columns in one row do not break the catalog (D-402)', async () => {
      boot(insertBad, flags)
      const d = await catalog()
      expect(d.total).toBe(2)
      const bad = d.agents.find((a: { slug: string }) => a.slug === 'bad')
      expect(bad.tags).toEqual([])
      expect(bad.toolNames).toEqual([])
      expect(bad.inputFields).toEqual([])
      const odd = d.agents.find((a: { slug: string }) => a.slug === 'odd')
      expect(odd.tags).toEqual([])
      expect(odd.toolNames).toEqual(['ok'])
      expect(odd.inputFields).toEqual([])
    })

    it('corrupt JSON columns: search fallback path and detail still load (D-402)', async () => {
      boot(insertBad, flags)
      const d = await catalog('?q=bad')
      expect(Array.isArray(d.agents)).toBe(true)
      const det = await detail('bad')
      expect(det.agent.tags).toEqual([])
      expect(det.agent.fixedFields).toEqual([])
      expect(det.agent.customizableFields).toEqual([])
      expect(det.agent.inputFields).toEqual([])
    })

    it('corrupt JSON columns: compare still loads (D-402)', async () => {
      boot(insertBad, { ...flags, AGENT_COMPARE: '1' })
      const c = await compare('?agents=bad&agents=odd')
      expect(c.agents).toHaveLength(2)
      expect(JSON.stringify(c.rows)).toBeTruthy()
    })

    it('hostile catalog params never 500 on a populated db', async () => {
      boot(insertBad, flags)
      for (const qs of ['?page=0', '?page=1e9', '?page=%00', '?q=%00', "?q=' OR 1=1 --", '?q=%25%25%25', '?q=%F0%9F%92%A9', '?kind=__proto__', '?compare=a&compare=b&compare=c&compare=d&compare=e', '?category=%00', '?page=2&page=3']) {
        const d = await catalog(qs)
        expect(Array.isArray(d.agents), qs).toBe(true)
        expect(d.page).toBeGreaterThanOrEqual(1)
      }
    })

    it('bad compare params never 500', async () => {
      boot(insertBad, { ...flags, AGENT_COMPARE: '1' })
      for (const qs of ['', '?agents=', '?agents=%00', '?agents=bad&agents=bad&agents=bad&agents=bad&agents=bad', `?agents=${'z'.repeat(10_000)}`, '?agents[]=bad']) {
        const c = await compare(qs)
        expect(Array.isArray(c.rows), qs).toBe(true)
      }
    })
  })
}

describe('E6 db bootstrap (D-403)', () => {
  it('importing db.ts creates a missing parent directory instead of throwing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e6-'))
    const p = join(dir, 'does', 'not', 'exist', 'c.db')
    vi.resetModules()
    vi.stubEnv('CATALOG_DB_PATH', p)
    await import('$lib/server/db.js')
    expect(existsSync(p)).toBe(true)
  })
})

describe('E6 flags-off 404s (before anything is read)', () => {
  it('/compare and /mcp-test are 404 with flags off', async () => {
    boot(undefined, {})
    expect(await status(compare(''))).toBe(404)
    const m = await import('./mcp-test/+page.server')
    expect(await status(Promise.resolve().then(() => (m.load as unknown as Fn)({})))).toBe(404)
  })
})
