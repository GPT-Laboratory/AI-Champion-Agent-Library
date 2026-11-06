// End to end: invented OData metadata -> real registry -> adapter -> generate(). Byte equality against golden files.
// Regenerate only deliberately, then read the diff: UPDATE_GOLDEN=1 npx vitest run src/lib/mcpgen/adapters/odata.golden.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parseInput, prepareInput } from '../registry'
import { generate, stableJson } from '../generate'

const GOLDEN = fileURLToPath(new URL('../__golden__/', import.meta.url))
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../testing/fixtures/${name}`, import.meta.url)), 'utf8')
const update = process.env.UPDATE_GOLDEN === '1'

function check(file: string, actual: string) {
  const path = join(GOLDEN, file)
  if (update) {
    mkdirSync(GOLDEN, { recursive: true })
    writeFileSync(path, actual)
    return
  }
  expect(actual).toBe(readFileSync(path, 'utf8'))
}

const cases = [
  ['odata-xml', fixture('acme-odata.xml')],
  ['odata-json', fixture('acme-odata.json')],
] as const
await prepareInput({ text: cases[0][1] })

const built = cases.map(([name, text]) => {
  const parsed = parseInput({ text })
  if (!parsed.ok) throw new Error(`${name} fixture must parse`)
  return { name, model: parsed.model, result: generate(parsed.model, {}) }
})

describe.each(built)('$name golden', ({ name, model, result }) => {
  const file = (n: string) => result.files.find((f) => f.path === n)!.content
  it('model, server.py, test_server.py and report are byte-stable', () => {
    check(`${name}.model.json`, stableJson(model))
    check(`${name}.server.py`, file('server.py'))
    check(`${name}.test_server.py`, file('test_server.py'))
    check(`${name}.report.json`, file('report.json'))
  })
  it('server.py carries the OData behaviours and nothing from the document that must not leak', () => {
    const server = file('server.py')
    expect(server).toContain('"$top": page_size')
    expect(server).toContain('page_size = _clamp(page_size, 1, 100)')
    expect(server).toContain('_odata_filter("Product", field, match, value)')
    expect(server).toContain('_odata_path("OrderLine", [order_id, line_number])')
    expect(server).toContain('ACME_CATALOG_BASE_URL')
    expect(server).toContain('ACME_CATALOG_ACCESS_TOKEN')
    expect(server).toContain('_odata_capped_warning(len(all_rows), page_size)') // CR-19
    expect(server).not.toContain('$expand')
    expect(server).not.toContain('ArchiveProduct')
    expect(server).not.toContain('Photo')
    for (const f of result.files) expect(f.content, f.path).not.toMatch(/https?:\/\/|vocab\.acme|acme\.example/)
  })
  it('the report lists dropped actions, unsupported functions and the oauth2 note', () => {
    const codes = result.report.gaps.map((g) => g.code)
    expect(result.report.gaps.filter((g) => g.code === 'write-dropped').map((g) => g.path)).toEqual(['Acme.Catalog.ArchiveProduct'])
    expect(codes).toEqual(expect.arrayContaining(['odata-function-unsupported', 'oauth2-flow-not-implemented', 'external-reference-not-fetched', 'ceiling-unknown']))
    expect(result.report.envVars.map((e) => e.name).sort()).toEqual(['ACME_CATALOG_ACCESS_TOKEN', 'ACME_CATALOG_BASE_URL'])
  })
  it('is deterministic', () => {
    expect(stableJson(generate(model, {}).report)).toBe(stableJson(result.report))
    expect(generate(model, {}).files.map((f) => f.content)).toEqual(result.files.map((f) => f.content))
  })
})

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
const hasPython = spawnSync('python3', ['-I', '--version'], { encoding: 'utf8' }).status === 0
describe.skipIf(!hasPython)('py_compile of the odata goldens', () => {
  for (const { name, result } of built) {
    it(`${name}: server.py and test_server.py compile (syntax only, never executed)`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'mcpgen-odata-'))
      dirs.push(dir)
      for (const f of ['server.py', 'test_server.py']) {
        const path = join(dir, f)
        writeFileSync(path, result.files.find((x) => x.path === f)!.content)
        const res = spawnSync('python3', ['-I', '-m', 'py_compile', path], { encoding: 'utf8' })
        expect(res.status, `${f}: ${res.stderr}`).toBe(0)
      }
    })
  }
})
