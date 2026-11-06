// Swagger 2.0, OAuth2 and OpenAPI 3.1 fixtures end to end (D-520, D-521, D-530, D-531): text -> registry -> adapter ->
// generate(). Byte equality against golden files (model, server.py, report.json).
// Regenerate only deliberately, then read the diff: UPDATE_GOLDEN=1 npx vitest run src/lib/mcpgen/adapters/openapi.formats.golden.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parseInput } from '../registry'
import { generate, stableJson } from '../generate'

const GOLDEN = fileURLToPath(new URL('../__golden__/', import.meta.url))
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

const CASES = [
  { fixture: 'acme-swagger2.yaml', golden: 'swagger2-yaml', env: ['ACME_SWAGGER_PARTS_BASE_URL', 'ACME_SWAGGER_PARTS_API_KEY'] },
  { fixture: 'acme-swagger2.json', golden: 'swagger2-json', env: ['ACME_SWAGGER_ORDERS_BASE_URL', 'ACME_SWAGGER_ORDERS_ACCESS_TOKEN'] },
  { fixture: 'acme-oauth2.yaml', golden: 'oauth2', env: ['ACME_LEDGER_BASE_URL', 'ACME_LEDGER_ACCESS_TOKEN'] },
  { fixture: 'acme-openapi31.yaml', golden: 'openapi31', env: ['ACME_ASSETS_BASE_URL'] },
] as const

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
const hasPython = spawnSync('python3', ['-I', '--version'], { encoding: 'utf8' }).status === 0

for (const c of CASES) {
  const text = readFileSync(fileURLToPath(new URL(`../testing/fixtures/${c.fixture}`, import.meta.url)), 'utf8')
  const parsed = parseInput({ text })
  if (!parsed.ok) throw new Error(`${c.fixture} must parse`)
  const result = generate(parsed.model, {})
  const file = (name: string) => result.files.find((f) => f.path === name)!.content

  describe(`golden ${c.fixture}`, () => {
    it('model, server.py and report.json are byte-stable', () => {
      check(`${c.golden}.model.json`, stableJson(parsed.model))
      check(`${c.golden}.server.py`, file('server.py'))
      check(`${c.golden}.report.json`, file('report.json'))
    })
    it('names the env vars and never carries a host from the document', () => {
      for (const name of c.env) expect(file('server.py')).toContain(name)
      for (const f of result.files) expect(f.content).not.toMatch(/acme\.example/)
    })
    it.skipIf(!hasPython)('server.py and test_server.py compile (syntax only, never executed)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'mcpgen-fmt-'))
      dirs.push(dir)
      for (const name of ['server.py', 'test_server.py']) {
        const path = join(dir, name)
        writeFileSync(path, file(name))
        const res = spawnSync('python3', ['-I', '-m', 'py_compile', path], { encoding: 'utf8' })
        expect(res.status, `${name}: ${res.stderr}`).toBe(0)
      }
    })
  })
}
