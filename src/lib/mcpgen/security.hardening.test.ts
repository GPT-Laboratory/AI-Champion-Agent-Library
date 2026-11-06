// Phase 23 security audit (23-SECURITY.md): malicious-input tests for the untrusted-input surfaces. Nothing generated
// is ever executed: Python output is only parsed by `python3 -I` with the ast module and walked.
import { afterAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { loadXmlParser } from './adapters/odata-xml'
import { runPipeline } from './pipeline'
import { prepareInput } from './registry'
import { evaluateProposals } from './proposals/index'
import { doc, fixtureText, loadFixture, op, run } from './proposals/testkit'

const hasPython = spawnSync('python3', ['-I', '--version'], { encoding: 'utf8' }).status === 0
await loadXmlParser()

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

// ---- AST audit of emitted Python --------------------------------------------------------------------------------
const AUDIT = `
import ast, sys, json
src = open(sys.argv[1], encoding='utf-8').read()
tree = ast.parse(src)
imports, bad = set(), []
BAD = {'system','popen','eval','exec','__import__','spawn','Popen','check_output','check_call','startfile'}
for n in ast.walk(tree):
    if isinstance(n, ast.Import):
        imports.update(a.name for a in n.names)
    elif isinstance(n, ast.ImportFrom):
        imports.add((n.module or '') + ':' + ','.join(sorted(a.name for a in n.names)))
    elif isinstance(n, ast.Call):
        f = n.func
        name = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else ''
        if name in BAD: bad.append(name)
print(json.dumps({'imports': sorted(imports), 'bad': sorted(bad), 'marker': any(isinstance(n, (ast.Name, ast.Attribute)) and 'PWNED' in (getattr(n,'id',None) or getattr(n,'attr','') or '') for n in ast.walk(tree))}))
`
interface Audit {
  imports: string[]
  bad: string[]
  marker: boolean
}
function audit(label: string, content: string): Audit {
  const dir = mkdtempSync(join(tmpdir(), 'mcpgen-sec-'))
  dirs.push(dir)
  const f = join(dir, 'x.py')
  writeFileSync(f, content)
  const r = spawnSync('python3', ['-I', '-c', AUDIT, f], { encoding: 'utf8' })
  expect(r.status, `${label}: ${r.stderr}`).toBe(0)
  return JSON.parse(r.stdout) as Audit
}

const P = '"""\n\'\'\'\r\u2028\u2029\\ \\N{x} {0} {x!r} %s %(a)s ${x} `; import os; os.system("PWNED"); PWNED = 1 # \u0000'
const STRING_KEYS = new Set(['title', 'description', 'summary', 'operationId', 'name', 'default', 'example', 'pattern', 'url', 'format', 'termsOfService', 'x-description'])

const KEY_PAYLOAD = 'x___PWNED_import_os'

function mutateDoc(v: unknown, keys: boolean): unknown {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : mutateDoc(x, keys)))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof x === 'string' && STRING_KEYS.has(k)) out[k] = k === 'url' || k === 'format' ? x : `${x}${P}`
      else if (k === 'enum' && Array.isArray(x)) out[k] = [...x, P]
      else if (keys && (k === 'properties' || k === 'paths') && x && typeof x === 'object') {
        const m: Record<string, unknown> = {}
        for (const [pk, pv] of Object.entries(x as Record<string, unknown>)) m[k === 'paths' ? `${pk}/${KEY_PAYLOAD}` : `${pk}_${KEY_PAYLOAD}`] = mutateDoc(pv, keys)
        out[k] = m
      } else out[k] = mutateDoc(x, keys)
    }
    return out
  }
  return v
}

const DOCS: [string, string][] = [
  ['acme-openapi.yaml', 'acme-openapi.yaml'],
  ['acme-openapi31.yaml', 'acme-openapi31.yaml'],
  ['acme-oauth2.yaml', 'acme-oauth2.yaml'],
  ['acme-swagger2.yaml', 'acme-swagger2.yaml'],
  ['acme-swagger2.json', 'acme-swagger2.json'],
  ['acme-odata.json', 'acme-odata.json'],
]

describe('T-23-05 emitted Python: hostile strings never become code (AST audit)', () => {
  it.skipIf(!hasPython).each(DOCS)('%s: values carrying quotes, newlines, U+2028 and a code payload stay inside literals', async (name, file) => {
    const text = fixtureText(file)
    const base = runPipeline(text, { filename: file })
    expect(base.ok).toBe(true)
    const baseAudit = audit(`${name}/baseline`, base.ok ? base.files.find((f) => f.path === 'server.py')!.content : '')
    for (const keys of [false, true]) {
      const hostile = JSON.stringify(mutateDoc(parseYaml(text), keys))
      await prepareInput({ text: hostile, filename: 'hostile.json' })
      const r = runPipeline(hostile, { filename: 'hostile.json' })
      if (!keys) expect(r.ok, `${name}: hostile values must still generate`).toBe(true)
      if (!r.ok) continue
      if (!keys && !name.startsWith('acme-odata')) expect(r.files.some((f) => f.content.includes('PWNED')), `${name}: the payload must reach the emitter (test is not vacuous)`).toBe(true)
      for (const f of r.files) {
        if (f.path.endsWith('.py')) {
          const a = audit(`${name}/${f.path}`, f.content)
          expect(a.bad, `${name}/${f.path}`).toEqual([])
          expect(a.marker, `${name}/${f.path}: payload became an identifier`).toBe(false)
          if (f.path === 'server.py') expect(a.imports).toEqual(baseAudit.imports)
        }
        if (f.path.endsWith('.json')) expect(() => JSON.parse(f.content), f.path).not.toThrow()
        if (f.path === 'requirements.txt') for (const l of f.content.split('\n').filter((l) => l && !l.startsWith('#'))) expect(l, 'requirements line').toMatch(/^[A-Za-z0-9_.\-\[\]]+\s*([<>=!~]=?[0-9A-Za-z.*,<>=!~ ]+)?(\s*#.*)?$/)
      }
    }
  })

  it.skipIf(!hasPython)('SQL, Prisma, tabular and OData XML with payloads in quoted identifiers, comments and headers', async () => {
    const sqlEsc = P.replace(/'/g, "''")
    const inputs: [string, string][] = [
      ['x.sql', fixtureText('acme-schema.sql').replace(/COMMENT '[^']*'/g, `COMMENT '${sqlEsc}'`) + `\nCREATE TABLE "t${P.replace(/"/g, '""')}" (id INTEGER PRIMARY KEY, "c${P.replace(/"/g, '""')}" TEXT);\n`],
      ['x.sql', fixtureText('acme-schema.sql') + `\nCREATE TABLE evil (id INTEGER PRIMARY KEY, name TEXT DEFAULT '${sqlEsc}', CHECK (name <> '${sqlEsc}'));\n`],
      ['x.prisma', fixtureText('acme-prisma.prisma') + `\n/// ${P.replace(/\n/g, ' ')}\nmodel Evil {\n  id Int @id\n  /// ${P.replace(/\n/g, ' ')}\n  name String @default("${P.replace(/["\\\n\r]/g, '')}")\n}\n`],
      ['x.csv', 'WG010,WG020,WG030\n' + ['a', 'b', 'c'].map((c) => `"${c}${P.replace(/"/g, '""')}"`).join(',') + '\n1,x,y\n'],
      ['x.csv', fixtureText('acme-catalog-header.csv') + '\n# dictionary\n' + fixtureText('acme-catalog-dictionary.csv').split('\n').map((l) => l + ',' + `"${P.replace(/"/g, '""')}"`).join('\n')],
      ['x.xml', fixtureText('acme-odata.xml').replace(/Name="(\w+)"/, `Name="$1_${P.replace(/[^A-Za-z0-9 ]/g, '')}"`).replace(/<Schema /, `<Schema Alias="&quot;&#10;&#8232;${P.replace(/[<>&"\n\r]/g, '')}" `)],
    ]
    for (const [filename, text] of inputs) {
      await prepareInput({ text, filename })
      const r = runPipeline(text, { filename })
      if (!r.ok) continue
      for (const f of r.files) {
        if (!f.path.endsWith('.py')) continue
        const a = audit(`${filename}/${f.path}`, f.content)
        expect(a.bad, `${filename}/${f.path}`).toEqual([])
        expect(a.marker).toBe(false)
      }
    }
  })
})

// ---- proposal file input ----------------------------------------------------------------------------------------
describe('T-23-02 proposal file: hostile JSON', () => {
  const fx = loadFixture('acme-openapi.yaml')
  const evaluate = (text: string, lenient = false) => evaluateProposals({ model: fx.model, options: fx.options, text, lenient })

  it('an oversize file is refused before parsing', () => {
    const ev = evaluate(' '.repeat(262_145))
    expect(ev.ok).toBe(false)
    expect(ev.fatal[0].code).toBe('file-too-large')
  })
  it('a deeply nested value is refused without a stack overflow, and a multi-byte file over the cap by bytes', () => {
    const deep = '['.repeat(200_000) + ']'.repeat(200_000)
    const ev = evaluate(deep)
    expect(ev.ok).toBe(false)
    expect(['bad-json', 'schema-invalid', 'file-too-large']).toContain(ev.fatal[0].code)
    expect(evaluate('é'.repeat(140_000)).fatal[0].code).toBe('file-too-large')
  })
  it('__proto__, constructor and prototype keys never pollute and never reach the plan', () => {
    const before = Object.keys(Object.prototype).length
    const base = { version: 1, baseline: { fingerprint: fx.fingerprint } }
    const texts = [
      `{"__proto__":{"polluted":"yes"},"version":1,"baseline":{"fingerprint":"${fx.fingerprint}"},"ops":[]}`,
      JSON.stringify({ ...base, ops: [] }).replace('"ops"', '"constructor":{"prototype":{"polluted":1}},"ops"'),
      doc(fx, [op('split_tool', 's1', { tool: 'search_part', tools: [{ name: 'part_a_only', description: 'x', fixed: JSON.parse('{"__proto__":"x","constructor":"y"}') }] })]),
      doc(fx, [op('composite_tool', 'c1', { name: 'part_combo', description: 'x', args: [], steps: [{ id: 's1', tool: 'search_part', args: JSON.parse('{"__proto__":{"const":"x"},"q":{"const":"a"}}') }], output: JSON.parse('{"__proto__":"s1.items"}') })]),
    ]
    for (const t of texts) {
      for (const lenient of [false, true]) {
        const ev = evaluate(t, lenient)
        void ev
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
      }
    }
    expect(Object.keys(Object.prototype).length).toBe(before)
  })
  it('injection strings in name, text, constant and selector fields are rejected or emitted escaped', () => {
    const evil = '"""\n__import__("os").system("PWNED")\u2028'
    const ops = [
      op('rename_tool', 'a1', { tool: 'search_part', name: `x${evil}` }),
      op('rename_arg', 'a2', { tool: 'search_part', arg: 'q', name: `x${evil}` }),
      op('describe_tool', 'a3', { tool: 'search_part', text: evil }),
      op('pin_arg', 'a4', { tool: 'search_part', arg: 'q', value: evil }),
      op('set_arg_default', 'a5', { tool: 'search_part', arg: 'q', value: evil }),
      op('set_projection', 'a6', { entity: 'part', fields: [`name${evil}`] }),
      op('derived_filter', 'a7', { entity: `part${evil}`, source: 'x', description: evil }),
      op('composite_tool', 'a8', { name: 'part_combo', description: 'x', args: [], steps: [{ id: 's1', tool: 'search_part', args: { q: { from: `args.q${evil}` } } }], output: { r: `s1${evil}` } }),
    ]
    for (const o of ops) {
      const ev = run(fx, [o])
      expect(ev.ok, `${o.id} must be rejected by a gate`).toBe(false)
    }
    // text-valued fields that are allowed are cleaned: no control characters survive into the plan
    const ok = run(fx, [op('describe_tool', 'd1', { tool: 'search_part', text: 'Finds parts.\u2028\nNothing else.' })], true)
    const d = ok.plan?.tools.find((t) => t.name === 'search_part')?.description ?? ''
    expect(d).not.toMatch(/[\u0000-\u001f\u2028\u2029]/)
  })
  it.skipIf(!hasPython)('a lenient proposal with constants that carry quotes and newlines emits only literals', () => {
    const evil = '"""\n\'\'\'\\\u2028 PWNED'
    const ops = [op('pin_arg', 'p1', { tool: 'search_part', arg: 'q', value: evil }), op('set_arg_default', 'p2', { tool: 'search_part', arg: 'q', value: evil })]
    const r = runPipeline(fixtureText('acme-openapi.yaml'), { filename: 'x.yaml', proposals: { text: doc(fx, ops), lenient: true } })
    if (r.ok) {
      const a = audit('pin', r.files.find((f) => f.path === 'server.py')!.content)
      expect(a.bad).toEqual([])
      expect(a.marker).toBe(false)
    }
  })
  it('a regex-looking or backtracking string in a selector or name field is bounded in time', () => {
    const t0 = Date.now()
    const long = 'a'.repeat(100_000)
    for (const v of [`${long}!`, `${'['.repeat(5000)}`, `${'a.'.repeat(5000)}`, `(a+)+$${long}`]) {
      run(fx, [op('composite_tool', 'c1', { name: 'part_combo', description: 'x', args: [], steps: [{ id: 's1', tool: 'search_part', args: { q: { from: v } } }] })])
      run(fx, [op('rename_tool', 'r1', { tool: v, name: 'part_new' })])
    }
    expect(Date.now() - t0).toBeLessThan(3000)
  })
})

// ---- runtime behaviour of the emitted server with hostile ARGUMENTS (our own template code, stubbed fastmcp/httpx) ----
const STUBS = `
import sys, types, json, os
m = types.ModuleType('fastmcp')
class FastMCP:
    def __init__(self, *a, **k): pass
    def tool(self, *a, **k):
        if len(a) == 1 and callable(a[0]) and not k: return a[0]
        return lambda f: f
    def run(self, *a, **k): pass
m.FastMCP = FastMCP
sys.modules['fastmcp'] = m
h = types.ModuleType('httpx')
class _E(Exception): pass
h.HTTPError = h.TimeoutException = h.RequestError = _E
sys.modules['httpx'] = h
sys.path.insert(0, sys.argv[1])
import server
`
function runHarness(label: string, serverPy: string, body: string, env: Record<string, string> = {}): unknown {
  const dir = mkdtempSync(join(tmpdir(), 'mcpgen-dyn-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'server.py'), serverPy)
  writeFileSync(join(dir, 'driver.py'), STUBS + body)
  const r = spawnSync('python3', ['-I', join(dir, 'driver.py'), dir], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env }, timeout: 30_000 })
  expect(r.status, `${label}: ${r.stderr}`).toBe(0)
  return JSON.parse(r.stdout)
}
const serverOf = (file: string, filename: string, text = fixtureText(file)) => {
  const r = runPipeline(text, { filename })
  if (!r.ok) throw new Error(`${file} did not generate`)
  return r.files.find((f) => f.path === 'server.py')!.content
}

describe('T-23-05 emitted SQL server: hostile arguments never reach the SQL text', () => {
  it.skipIf(!hasPython)('injection in field, value, fields, limit and offset is rejected or bound as data; the database stays unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpgen-db-'))
    dirs.push(dir)
    const db = join(dir, 'acme.db')
    const setup = spawnSync(
      'python3',
      ['-I', '-c', `import sqlite3,sys\nc=sqlite3.connect(sys.argv[1])\nc.executescript(''.join(l for l in open(sys.argv[2]) if 'sqlite_sequence' not in l))\nc.execute("INSERT INTO customer(customer_name,segment,city) VALUES ('Ann','standard','Oslo'),('Bob','gold','Rome')")\nc.commit()`, db, join(__dirname, 'testing/fixtures/acme-sqlite.schema')],
      { encoding: 'utf8' },
    )
    expect(setup.status, setup.stderr).toBe(0)
    const out = runHarness(
      'sql',
      serverOf('acme-sqlite.schema', 'acme.schema'),
      `
import sqlite3
EVIL = ["x' OR '1'='1", "x'; DROP TABLE customer; --", '" OR 1=1 --', "%", "_", "\\\\", "\\x00", "a" * 300, "x\\u2028y"]
res = []
for v in EVIL:
    for mode in ("equals", "contains", "startsWith", "regex; DROP TABLE customer"):
        res.append(server.query_customer(field="customer_name", value=v, match=mode))
    res.append(server.query_customer(field=v, value="a"))
    res.append(server.query_customer(fields=[v]))
    res.append(server.query_customer(fields=["customer_name", v]))
for lim in (-1, 0, 10**9, "1; DROP TABLE customer", 1.5, None, True):
    for off in (-5, 10**12, "0 OR 1", None):
        try: res.append(server.query_customer(limit=lim, offset=off))
        except Exception as e: res.append({"raised": type(e).__name__})
conn = sqlite3.connect(os.environ["DB"] + "?mode=ro".replace("?mode=ro", ""))
count = conn.execute("SELECT COUNT(*) FROM customer").fetchone()[0]
hostile_equals = [server.query_customer(field="customer_name", value=v, match="equals") for v in EVIL]
leak = [r for r in hostile_equals if r.get("count", 0) != 0]
legit = server.query_customer(field="customer_name", value="ann", match="equals")
print(json.dumps({"count": count, "raised": [r for r in res if "raised" in r], "leak": len(leak), "legit": legit.get("count", 0), "legit_raw": legit, "total": len(res)}))
`,
      { ACME_DB_PATH: db, DB: db },
    ) as { count: number; raised: unknown[]; leak: number; legit: number; total: number }
    expect(out.count).toBe(2) // the table was never dropped or changed
    expect(out.legit).toBe(1) // the harness really queries the database (not vacuous)
    expect(out.leak).toBe(0) // an injected OR 1=1 would return rows; every hostile equals value matches none
    expect(out.raised.length).toBeLessThanOrEqual(out.total)
  })
})

describe('T-23-05 emitted OData server: keys and filter values stay one literal', () => {
  it.skipIf(!hasPython)('path keys are encoded, filter text is a single quoted literal, typed values are validated', () => {
    const out = runHarness(
      'odata',
      serverOf('acme-odata.xml', 'acme-odata.xml'),
      `
calls = []
def fake(path, params=None):
    calls.append([path, dict(params or {})])
    return 200, '{"value": []}'
server._raw_get = fake
EVIL = ["1)/$value", "x')/../../secret", "..", ".", "%2e%2e", "a/b", "a?b=c", "a#b", "1 or 1 eq 1", "a'b", "x'); DELETE", "\\n", "é" * 40]
res = []
for v in EVIL:
    for call in (lambda: server.lookup_product_by_id(id=v), lambda: server.lookup_supplier_by_supplier_code(supplier_code=v),
                 lambda: server.list_products(field="name", value=v, match="equals"), lambda: server.list_products(field="name", value=v, match="contains"),
                 lambda: server.list_products(field="name", value=v, match="startsWith")):
        n = len(calls)
        try: call()
        except Exception as e: res.append({"raised": type(e).__name__})
        res.extend(calls[n:])
print(json.dumps(res))
`,
      { ACME_CATALOG_BASE_URL: 'http://127.0.0.1:9' },
    ) as ({ raised: string } | [string, Record<string, string>])[]
    let seen = 0
    for (const c of out) {
      if (!Array.isArray(c)) continue
      seen++
      const [path, params] = c
      expect(path, 'the path is one entity-set segment with one key predicate').toMatch(/^\/[A-Za-z_]+\((?:[A-Za-z0-9_%'.~-]|=|,)*\)$/)
      const f = params['$filter']
      if (f !== undefined) expect(f).toMatch(/^(?:\w+ eq '(?:[^']|'')*'|(?:contains|startswith)\(\w+,'(?:[^']|'')*'\))$/)
      for (const k of Object.keys(params)) expect(k).toMatch(/^\$(filter|select|top|skip|count|orderby)$/)
    }
    expect(seen).toBeGreaterThan(0)
  })
})

describe('T-23-01 sax reader: amplification and nesting inputs are rejected fast', () => {
  const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]><lolz>&lol3;</lolz>`
  const timed = <T,>(f: () => T) => {
    const t = Date.now()
    const v = f()
    return { v, ms: Date.now() - t }
  }
  it('billion laughs, parameter entities and external entities never reach the parser', async () => {
    const { parseXml } = await import('./adapters/odata-xml')
    for (const x of [bomb, '<!DOCTYPE a [<!ENTITY % p SYSTEM "http://127.0.0.1:1/x">%p;]><a/>', '<!DOCTYPE a SYSTEM "file:///etc/passwd"><a/>']) {
      const { v, ms } = timed(() => parseXml(x))
      expect('gap' in v && v.gap.code === 'doctype-rejected').toBe(true)
      expect(ms).toBeLessThan(500)
    }
  })
  it('an undeclared entity reference and a nesting or width bomb are bounded', async () => {
    const { parseXml } = await import('./adapters/odata-xml')
    expect(timed(() => parseXml('<a>&undeclared;</a>')).v).toHaveProperty('gap')
    const deep = timed(() => parseXml('<a>'.repeat(100_000) + '</a>'.repeat(100_000)))
    expect('gap' in deep.v).toBe(true)
    expect(deep.ms).toBeLessThan(1500)
    const wide = timed(() => parseXml(`<r>${'<e a="1"/>'.repeat(90_000)}</r>`))
    expect('gap' in wide.v).toBe(true)
    expect(wide.ms).toBeLessThan(2500)
    const attrs = timed(() => parseXml(`<r ${Array.from({ length: 5000 }, (_, i) => `a${i}="v"`).join(' ')}/>`))
    expect('gap' in attrs.v).toBe(true)
    const nsbomb = timed(() => parseXml(`<r ${Array.from({ length: 5000 }, (_, i) => `xmlns:p${i}="urn:${i}"`).join(' ')}/>`))
    expect(nsbomb.ms).toBeLessThan(2500)
  })
})

describe('T-23-04 binding file', () => {
  it('a __proto__ or constructor key cannot change the parsed object or reach an entry', async () => {
    const { parseBindingFile } = await import('../mcptest/core/bindingSchema')
    for (const t of ['{"__proto__":{"tool":"x"}}', '{"a":{"tool":"x","args":{"__proto__":{"polluted":1}}}}', '{"constructor":{"tool":"x"}}']) {
      const p = parseBindingFile(t)
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
      if (p) expect(Object.getPrototypeOf(p)).toBe(Object.prototype)
      if (p && !Object.keys(p).includes('__proto__')) expect((p as Record<string, unknown>).tool).toBeUndefined()
    }
  })
  it('a traversal-looking tool name is only ever compared with the server tool list', async () => {
    const { bindTool } = await import('../mcptest/core/binding')
    const r = bindTool({}, [{ name: 'search_part' } as never], { tool: '../../etc/passwd' })
    expect(r.status).toBe('no_tool')
  })
})

describe('T-23-06 container path: hostile requests and package paths never reach the engine', () => {
  it('a bad driver request or package path is refused before any runtime call', async () => {
    const { runInContainer } = await import('../server/mcptest/containerRun')
    const touched: string[] = []
    const runtime = new Proxy({}, { get: (_t, k) => () => { touched.push(String(k)); throw new Error('engine touched') } }) as never
    const good = { v: 1, subject: { kind: 'staged', command: 'python3', args: ['server.py'], cwd: '/work/pkg', id: 'generator:openapi' } }
    const bad: unknown[] = [
      { ...good, subject: { ...good.subject, args: ['-c', 'import os'] } },
      { ...good, subject: { ...good.subject, args: ['../../etc/x.py'] } },
      { ...good, subject: { ...good.subject, cwd: '/etc' } },
      { ...good, subject: { ...good.subject, cwd: '/work/pkg/../../etc' } },
      { ...good, subject: { ...good.subject, command: 'sh' } },
      { ...good, subject: { ...good.subject, envNames: { apiKey: 'LD_PRELOAD' } } },
      { ...good, subject: { ...good.subject, envNames: { apiKey: 'PATH' } } },
      { ...good, extra: 1 },
    ]
    for (const req of bad) {
      const r = await runInContainer(runtime, req as never, [], { driverTree: [] })
      expect(r.ok, JSON.stringify(req)).toBe(false)
      expect(touched, JSON.stringify(req)).toEqual([])
    }
    for (const path of ['../evil.py', '/etc/passwd', 'a/../../b', 'a\\b', 'a/\u0000b', '']) {
      const r = await runInContainer(runtime, good as never, [{ path, content: 'x' }], { driverTree: [] })
      expect(r.ok, path).toBe(false)
      expect(touched, path).toEqual([])
    }
    expect(touched).toEqual([])
  })
})
