import { describe, it, expect } from 'vitest'
import { generate, stableJson } from './generate'
import { acmeHttp, acmeDataset, acmeSql } from './testing/sample-models'
import type { DerivedTool, SourceModel } from './types'

const server = (m: SourceModel, o = {}, d: DerivedTool[] = []) => generate(m, o, d).files.find((f) => f.path === 'server.py')!.content
const codeLines = (t: string) => t.split('\n').filter((l) => !l.trim().startsWith('#'))

const MODELS: [string, SourceModel][] = [
  ['http', acmeHttp],
  ['dataset', acmeDataset],
  ['sql', acmeSql],
]

describe.each(MODELS)('generate: %s backend', (_n, model) => {
  const result = generate(model, {})
  const py = result.files.find((f) => f.path === 'server.py')!.content

  it('is deterministic and does not mutate the model', () => {
    const before = JSON.stringify(model)
    expect(generate(model, {})).toEqual(result)
    expect(JSON.stringify(model)).toBe(before)
  })
  it('emits the package files in a fixed order', () => {
    expect(result.files.map((f) => f.path)).toEqual(['server.py', 'test_server.py', 'requirements.txt', 'README.generated.md', 'report.json', 'mcptest-binding.json'])
  })
  it('uses fastmcp over stdio and no other server SDK', () => {
    expect(py).toContain('from fastmcp import FastMCP')
    expect(py).toContain('mcp = FastMCP(')
    expect(py).toMatch(/if __name__ == "__main__":\n {4}mcp\.run\(\)\n$/)
    expect(py).not.toMatch(/^\s*(import|from) mcp\b/m)
    expect(py).not.toContain('dotenv')
  })
  it('never copies exception text or tracebacks and catches everything per tool', () => {
    expect(py).not.toMatch(/str\(e[a-z]*\)/)
    expect(py).not.toContain('Traceback')
    expect(py).not.toContain('traceback')
    const defs = result.report.toolsEmitted.length
    expect((py.match(/    except Exception:/g) ?? []).length).toBeGreaterThanOrEqual(defs - 1)
    expect(py).toContain('{"ok": False, "kind": kind, "message": message, "hint": hint}')
  })
  it('holds no literal URL, key or secret from input; config comes from os.environ only', () => {
    for (const f of result.files) {
      const code = codeLines(f.content).join('\n')
      expect(code).not.toMatch(/https?:\/\//)
      expect(f.content).not.toMatch(/\bsk-[A-Za-z0-9]/)
      expect(f.content).not.toContain('docs.acme.example')
    }
    expect(py).not.toContain('Bearer ')
    for (const m of py.matchAll(/os\.environ[^\n]*/g)) expect(m[0]).toMatch(/os\.environ\.get\(/)
  })
  it('states the clamp and limits, and emits no write tools', () => {
    expect(py).toMatch(/clamped to the range 1 to \d+/)
    expect(py).toMatch(/_clamp\((page_size|limit), 1, \d+\)/)
    expect(py).not.toMatch(/^def (create|update|delete|post|put|patch|remove|write)_/m)
    expect(py).not.toMatch(/httpx\.(post|put|patch|delete)/)
  })
  it('emits the ceiling branch only when a ceiling is set', () => {
    expect(py.includes('Result ceiling reached')).toBe(model.limits.resultCeiling !== undefined)
    const without = server({ ...model, limits: { maxPageSize: 50, maxResponseItems: 200 } })
    expect(without).not.toContain('Result ceiling reached')
  })
  it('reports tools, env vars and assumptions', () => {
    expect(result.report.toolsEmitted.length).toBeGreaterThan(0)
    expect(result.report.envVars.length).toBeGreaterThan(0)
    expect(result.report.assumptions.join(' ')).toContain('UNVERIFIED')
    expect(result.files.find((f) => f.path === 'requirements.txt')!.content).toContain('fastmcp>=3.4,<5')
  })
  it('README has an env table and an .mcp.json snippet with placeholders only', () => {
    const readme = result.files.find((f) => f.path === 'README.generated.md')!.content
    expect(readme).toContain('| Name | Purpose |')
    expect(readme).toContain('"command": "python"')
    expect(readme).toMatch(/<set [A-Z_]+>/)
    expect(readme).not.toMatch(/(^|[\s"'])\/(home|Users|tmp)\//)
  })
})

describe('generate: http specifics', () => {
  const py = server(acmeHttp)
  it('emits the derived filter tool that fetches its own candidates and reports coverage', () => {
    expect(py).toContain('def filter_product_by_features(key: str')
    expect(py).toContain('rows = _rows(_http_json("/products", query))')
    expect(py).toContain('"pages_scanned": scanned')
    expect(py).toContain('"truncated": truncated')
    expect(py).not.toMatch(/def filter_\w+\([^)]*(products|candidates)\b/)
  })
  it('maps auth failures to a message naming the env var only', () => {
    expect(py).toContain('"Authentication failed: check the API key configured in ACME_API_KEY"')
    expect(py).toContain('    if not key:\n        raise _Fail("auth", _AUTH_MESSAGE)\n    headers[AUTH_NAME] = key\n    response = httpx.get(')
  })
  it('lists the dropped write in the report and emits no create tool', () => {
    const r = generate(acmeHttp).report
    expect(r.toolsDropped.map((d) => d.id)).toContain('createProduct')
    expect(py).not.toContain('createProduct')
  })
  it('accepts user-origin derived tools through the extension point', () => {
    const d: DerivedTool = { id: 'product.features.custom', kind: 'inMemoryFilter', entity: 'product', source: 'features', description: 'Custom filter', origin: 'user' }
    const r = generate(acmeHttp, {}, [d])
    expect(r.report.toolsEmitted).toContain('filter_product_by_features_2')
    expect(r.report.gaps.some((g) => g.code === 'derived-invalid')).toBe(false)
    const bad = generate(acmeHttp, {}, [{ ...d, entity: 'ghost' }])
    expect(bad.report.gaps.some((g) => g.code === 'derived-invalid')).toBe(true)
  })
  it('uses the right credential placement per scheme and never a Bearer literal otherwise', () => {
    const q = server({ ...acmeHttp, auth: { scheme: 'apiKeyQuery', paramName: 'key', envVar: 'ACME_API_KEY' } })
    expect(q).toContain('_AUTH_MESSAGE)\n    query[AUTH_NAME] = key\n')
    const b = server({ ...acmeHttp, auth: { scheme: 'bearer', envVar: 'ACME_TOKEN' } })
    expect(b).toContain('_AUTH_MESSAGE)\n    headers["Authorization"] = "Bearer " + key\n')
    const none = server({ ...acmeHttp, auth: { scheme: 'none' } })
    expect(none).not.toContain('os.environ.get(AUTH_ENV')
    expect(none).toContain('AUTH_ENV = None')
  })
  it('keeps hostile text from the source out of code and string delimiters', () => {
    const evil = '"""\nimport os; os.system("x")\n\\" https://evil.example/x sk-abcdefghijklmnop\u0000'
    const m: SourceModel = {
      ...acmeHttp,
      operations: acmeHttp.operations.map((o) => ({ ...o, summary: evil, params: o.params.map((p) => ({ ...p, description: evil })) })),
      entities: acmeHttp.entities.map((e) => ({ ...e, label: evil, fields: e.fields.map((f) => ({ ...f, description: evil })) })),
    }
    const t = server(m)
    expect((t.match(/"""/g) ?? []).length % 2).toBe(0)
    expect(t).not.toContain('evil.example')
    expect(t).not.toContain('sk-abc')
    expect(t).not.toContain('\u0000')
    expect(t).not.toMatch(/^import os; os\.system/m)
  })
  it('returns no files and an error gap when nothing can be generated', () => {
    const r = generate({ ...acmeHttp, operations: [] })
    expect(r.files).toEqual([])
    expect(r.report.gaps.some((g) => g.severity === 'error')).toBe(true)
  })
})

describe('generate: dataset and sql specifics', () => {
  it('dataset loads before assigning state and coerces to text', () => {
    const py = server(acmeDataset)
    expect(py).toContain('import csv')
    const load = py.slice(py.indexOf('def _load_rows'))
    expect(load.indexOf('loaded = [')).toBeGreaterThan(-1)
    expect(load.indexOf('loaded = [')).toBeLessThan(load.indexOf('_ROWS = loaded'))
    expect(py).not.toMatch(/\bpandas\b|openpyxl/)
  })
  it('sql uses parameters and allow-listed quoted identifiers only', () => {
    const py = server(acmeSql)
    expect(py).toContain('import sqlite3')
    expect(py).toContain('PRAGMA query_only = ON')
    expect(py).toContain('?mode=ro')
    expect(py).toContain('" LIMIT ? OFFSET ?"')
    expect(py).not.toMatch(/execute\(\s*f"/)
    expect(py).toContain('"table": "\\"order\\""')
    expect(py).not.toMatch(/\.format\(|%s/)
  })
})

describe('stableJson', () => {
  it('sorts keys and ends with a newline', () => {
    expect(stableJson({ b: 1, a: { d: 1, c: 2 } })).toBe('{\n  "a": {\n    "c": 2,\n    "d": 1\n  },\n  "b": 1\n}\n')
  })
})
