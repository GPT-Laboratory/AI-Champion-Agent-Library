// Golden outputs of proposal-assisted packages over the synthetic Acme OpenAPI and SQL fixtures: for each
// scenario the diff of server.py against the deterministic baseline (compact and reviewable) and the review
// summary. py_compile checks are guarded (python3 -I, temp dir outside the repository); the generated
// Python is never imported or executed. Regenerate only deliberately and read the diff:
//   UPDATE_GOLDEN=1 npx vitest run src/lib/mcpgen/proposals/golden.test.ts
import { describe, expect, it, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateFromPlan } from '../generate.js'
import { evaluateProposals } from './index.js'
import { renderReview } from './review.js'
import { loadFixture, doc, SCENARIOS } from './testkit.js'

const DIR = fileURLToPath(new URL('../__golden__/proposals/', import.meta.url))
const update = process.env.UPDATE_GOLDEN === '1'

function check(file: string, actual: string) {
  const path = join(DIR, file)
  if (update) {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(path, actual)
    return
  }
  expect(actual).toBe(readFileSync(path, 'utf8'))
}

/** Line diff (LCS) of two texts: only changed lines, each group preceded by its baseline line number. */
export function lineDiff(a: string, b: string): string {
  const x = a.split('\n')
  const y = b.split('\n')
  const t: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0))
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1])
  const out: string[] = []
  let i = 0
  let j = 0
  let inGroup = false
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      i++
      j++
      inGroup = false
      continue
    }
    if (!inGroup) out.push(`@@ baseline line ${i + 1} @@`)
    inGroup = true
    if (j < y.length && (i === x.length || t[i][j + 1] >= t[i + 1][j])) out.push(`+${y[j++]}`)
    else out.push(`-${x[i++]}`)
  }
  return out.join('\n') + '\n'
}

const probe = spawnSync('python3', ['-I', '--version'], { encoding: 'utf8' })
const hasPython = probe.status === 0
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const FILES = { http: 'acme-openapi.yaml', sql: 'acme-schema.sql' } as const

for (const kind of ['http', 'sql'] as const) {
  const fx = loadFixture(FILES[kind])
  const base = generateFromPlan(fx.plan)
  const baseServer = base.files.find((f) => f.path === 'server.py')!.content
  describe(`proposal goldens over ${FILES[kind]}`, () => {
    for (const [name, ops] of Object.entries(SCENARIOS[kind])) {
      it(`${name}: golden diff, review and py_compile`, () => {
        const ev = evaluateProposals({ model: fx.model, options: fx.options, text: doc(fx, ops) })
        expect(ev.ok, JSON.stringify([...ev.fatal, ...ev.rejected].map((i) => `${i.opId}:${i.code}`))).toBe(true)
        const out = generateFromPlan(ev.plan!)
        const server = out.files.find((f) => f.path === 'server.py')!.content
        check(`${kind}.${name}.server.diff`, lineDiff(baseServer, server))
        check(`${kind}.${name}.review.txt`, renderReview(ev))
        expect(out.files.map((f) => f.path).sort()).toEqual(base.files.map((f) => f.path).sort())
        if (!hasPython) return
        const dir = mkdtempSync(join(tmpdir(), 'mcpgen-prop-'))
        dirs.push(dir)
        for (const f of ['server.py', 'test_server.py']) {
          const file = join(dir, f)
          writeFileSync(file, out.files.find((x) => x.path === f)!.content)
          const r = spawnSync('python3', ['-I', '-m', 'py_compile', file], { encoding: 'utf8' })
          expect(r.status, `${kind}/${name}/${f}: ${r.stderr}`).toBe(0)
        }
      })
    }
  })
}

describe('golden hygiene', () => {
  it('the goldens contain only invented data', () => {
    for (const kind of ['http', 'sql'] as const) {
      const t = readFileSync(join(DIR, `${kind}.merge.review.txt`), 'utf8')
      expect(t).not.toMatch(/https?:\/\//)
    }
  })
})
