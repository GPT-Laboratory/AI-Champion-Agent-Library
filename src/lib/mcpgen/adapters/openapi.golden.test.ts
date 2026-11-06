// End to end: invented OpenAPI text -> real registry -> adapter -> generate(). Byte equality against golden files.
// Regenerate only deliberately, then read the diff: UPDATE_GOLDEN=1 npx vitest run src/lib/mcpgen/adapters/openapi.golden.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parseInput } from '../registry'
import { generate, stableJson } from '../generate'
import { buildPlan } from '../plan'

const GOLDEN = fileURLToPath(new URL('../__golden__/', import.meta.url))
const text = readFileSync(fileURLToPath(new URL('../testing/fixtures/acme-openapi.yaml', import.meta.url)), 'utf8')
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

const parsed = parseInput({ text })
if (!parsed.ok) throw new Error('fixture must parse')
const model = parsed.model
const result = generate(model, {})
const server = result.files.find((f) => f.path === 'server.py')!.content

describe('openapi golden', () => {
  it('model and server.py are byte-stable', () => {
    check('openapi.model.json', stableJson(model))
    check('openapi.server.py', server)
  })
  it('server.py carries the behaviours', () => {
    const plan = buildPlan(model, {})
    const filter = plan.tools.find((t) => t.derived?.kind === 'inMemoryFilter')
    expect(filter).toBeDefined()
    expect(server).toContain(filter!.name)
    expect(server).toContain('50')
    expect(server).not.toMatch(/createPart|deletePart|UsingGET/)
    expect(server).toContain('ACME_PARTS_BASE_URL')
    expect(server).toContain('ACME_PARTS_API_KEY')
    expect(server).toContain('X-Acme-Key')
    expect(server).not.toContain('acme.example')
    expect(server).not.toContain('sample-key-0000')
  })
  it('never leaks the server url into any generated file', () => {
    for (const f of result.files) expect(f.content).not.toContain('acme.example')
  })
  it('the report lists the dropped write operations', () => {
    const dropped = result.report.gaps.filter((g) => g.code === 'write-dropped').map((g) => g.path)
    expect(dropped).toEqual(['createPart', 'deletePart'])
  })
  it('a credential-bearing spec is rejected and nothing is generated', () => {
    const literal = ['k', 'e', 'y', '-', 'live', '1234567890abcdef'].join('')
    const withKey = `${text}\nx-test-config:\n  api_key: ${literal}\n`
    const r = parseInput({ text: withKey })
    expect(r.ok).toBe(false)
    expect(r.gaps.map((g) => g.code)).toContain('credential-rejected')
    expect(JSON.stringify(r)).not.toContain(literal)
  })
})

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
const hasPython = spawnSync('python3', ['-I', '--version'], { encoding: 'utf8' }).status === 0
describe.skipIf(!hasPython)('py_compile of the openapi golden', () => {
  it('server.py and test_server.py compile (syntax only, never executed)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpgen-oa-'))
    dirs.push(dir)
    for (const name of ['server.py', 'test_server.py']) {
      const file = join(dir, name)
      writeFileSync(file, result.files.find((f) => f.path === name)!.content)
      const res = spawnSync('python3', ['-I', '-m', 'py_compile', file], { encoding: 'utf8' })
      expect(res.status, `${name}: ${res.stderr}`).toBe(0)
    }
  })
})
