import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FIXTURE_FILE_CAP, loadSuite } from './suite'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mcptest-suite-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function mk(id: string, caseYaml: string, golden = '{"id":"a1","type":"tool_exists","tool_hint":"x"}\n', dirName = id) {
  const d = join(root, dirName)
  await mkdir(d, { recursive: true })
  await writeFile(join(d, 'case.yaml'), caseYaml)
  await writeFile(join(d, 'golden.jsonl'), golden)
  return d
}

const OK = (id: string) => `id: ${id}
tier: 2
x-upstream: { a: { datasets: [catalog] } }
x-applies-to: [fake]
`

describe('loadSuite', () => {
  it('loads cases sorted by directory with fixtures and parsed x blocks', async () => {
    const d = await mk('T2-ACME-B', OK('T2-ACME-B'))
    await mk('T2-ACME-A', OK('T2-ACME-A'))
    await mkdir(join(d, 'fixture', 'spec'), { recursive: true })
    await writeFile(join(d, 'fixture', 'spec', 'h.csv'), 'id,name\n')
    const r = await loadSuite(root)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.cases.map((c) => c.def.id)).toEqual(['T2-ACME-A', 'T2-ACME-B'])
    expect(r.cases[1].fixtureFiles).toEqual([{ path: 'spec/h.csv', content: 'id,name\n' }])
    expect(r.cases[0].x.upstream?.a.maxPageSize).toBe(50)
    expect(r.cases[0].x.appliesTo).toEqual(['fake'])
    expect(r.cases[0].rubric).toBeNull()
  })

  it('collects all errors with the case id prefix', async () => {
    await mk('T2-ACME-A', `id: T2-ACME-A\ntier: 2\nx-upstream: { a: { datasets: [nope] } }\nx-identity: { idKeys: [id] }\nx-applies-to: [robot]\n`)
    await mk('T2-ACME-B', OK('T2-ACME-B'), 'not json\n')
    const r = await loadSuite(root)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.startsWith('T2-ACME-A: x-upstream'))).toBe(true)
    expect(r.errors.some((e) => e.startsWith('T2-ACME-A: x-identity'))).toBe(true)
    expect(r.errors.some((e) => e.startsWith('T2-ACME-A: x-applies-to'))).toBe(true)
    expect(r.errors.some((e) => e.startsWith('T2-ACME-B: golden.jsonl'))).toBe(true)
  })

  it('rejects a case whose id differs from the directory name', async () => {
    await mk('T2-ACME-A', OK('T2-ACME-A'), undefined, 'T2-OTHER-DIR')
    const r = await loadSuite(root)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/does not match directory/)
  })

  it('skips symlinks and rejects oversize fixtures', async () => {
    const d = await mk('T2-ACME-A', OK('T2-ACME-A'))
    await mkdir(join(d, 'fixture'), { recursive: true })
    await writeFile(join(root, 'outside.txt'), 'secret')
    await symlink(join(root, 'outside.txt'), join(d, 'fixture', 'link.txt'))
    const r = await loadSuite(root)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.cases[0].fixtureFiles).toEqual([])
    await writeFile(join(d, 'fixture', 'big.txt'), 'a'.repeat(FIXTURE_FILE_CAP + 1))
    const r2 = await loadSuite(root)
    expect(r2.ok).toBe(false)
  })

  it('returns an error (not a throw) for a missing root', async () => {
    const r = await loadSuite(join(root, 'nope'))
    expect(r.ok).toBe(false)
  })
})
