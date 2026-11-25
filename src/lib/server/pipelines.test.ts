import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listPipelines, loadPipelineDef, loadPipelinePage, pipelinesOf } from './pipelines'

let root: string
beforeEach(() => (root = mkdtempSync(join(tmpdir(), 'pipelines-'))))
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('pipeline definitions', () => {
  it('the shipped pipeline: three steps in order, its data files, and the step number on each agent page', async () => {
    const p = await loadPipelineDef('rules-to-mbom')
    expect(p?.steps).toEqual(['scope-rule-drafter', 'ifc-ebom-compiler', 'product-sourcing-mbom'])
    expect((await listPipelines()).map((x) => x.slug)).toEqual(['rules-to-mbom'])
    expect(await pipelinesOf('ifc-ebom-compiler')).toEqual([{ slug: 'rules-to-mbom', title: 'Plain-language rules to E-BOM to M-BOM', step: 2 }])
    expect(await pipelinesOf('qto-normalization')).toEqual([])
  })

  it('no such pipeline, a bad slug or an invalid file', async () => {
    expect(await loadPipelineDef('nope')).toBeNull()
    expect(await loadPipelineDef('../etc')).toBeNull()
    mkdirSync(join(root, 'bad'))
    writeFileSync(join(root, 'bad', 'pipeline.yaml'), 'title: x\nsummary: y\nsteps: [a, b]\nmapping: m.csv\ncatalog: c.csv\n')
    await expect(loadPipelineDef('bad', root)).rejects.toThrow(/steps/)
    expect(await pipelinesOf('a', root)).toEqual([]) // a broken pipeline never breaks an agent page
  })

  it('the page data: titles, the agents\' example tasks, the E-BOM data, mapping and catalog', async () => {
    const page = (await loadPipelinePage('rules-to-mbom'))!
    expect(page.steps.map((s) => [s.slug, s.runnable])).toEqual([
      ['scope-rule-drafter', true],
      ['ifc-ebom-compiler', true],
      ['product-sourcing-mbom', true],
    ])
    expect(page.steps[0].task.split('\n')[0]).toBe('Sprinkler piping is delivered by the sprinkler contractor.')
    expect(page.data.name).toBe('sample-ebom-input.txt')
    expect(page.mapping).toContain('designation,req_class,req_dn,req_material')
    expect(page.catalog).toContain('product_id,supplier,name,class,dn,material,sales_unit,in_stock')
  })
})
