// A proposal applied to an OData-derived model: an argument rename goes through a prologue, so the wire names
// ($top, $skip, $filter) stay untouched; a hidden tool disappears; a derived filter is rejected with a stable
// code. py_compile is guarded (python3 -I, temp dir outside the repository); nothing is executed.
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateFromPlan } from '../generate.js'
import { buildPlan } from '../plan.js'
import { parseInput, prepareInput } from '../registry.js'
import type { SourceModel } from '../types.js'
import { buildExamples } from './examples.js'
import { evaluateProposals, fingerprintOf } from './index.js'
import { fixtureText, op } from './testkit.js'

const hasPython = spawnSync('python3', ['-I', '-c', 'pass']).status === 0
const server = (files: { path: string; content: string }[]) => files.find((f) => f.path === 'server.py')!.content

async function load(name: string): Promise<SourceModel> {
  const raw = { text: fixtureText(name), filename: name }
  await prepareInput(raw, { adapterId: 'odata' })
  const p = parseInput(raw, { adapterId: 'odata' })
  if (!p.ok) throw new Error(`${name} did not parse`)
  return p.model
}

const count = (s: string, needle: string) => s.split(needle).length - 1

for (const name of ['acme-odata.json', 'acme-odata.xml']) {
  describe(`proposals over ${name}`, () => {
    it('renames an argument and hides a tool; wire names stay untouched', async () => {
      const model = await load(name)
      const plan = buildPlan(model, {})
      const base = generateFromPlan(plan)
      const text = JSON.stringify({
        version: 1,
        baseline: { fingerprint: fingerprintOf(plan) },
        ops: [
          op('rename_arg', 'rename-size', { tool: 'list_products', arg: 'page_size', name: 'size' }),
          op('hide_tool', 'hide-suppliers', { tool: 'list_suppliers' }),
        ],
      })
      const ev = evaluateProposals({ model, options: {}, text })
      expect(ev.ok, JSON.stringify([...ev.fatal, ...ev.rejected])).toBe(true)
      const out = generateFromPlan(ev.plan!)
      const a = server(base.files)
      const b = server(out.files)
      expect(b).toMatch(/^def list_products\(page: int = 1, size: int = 20,/m)
      expect(b).toContain('    page_size = size')
      expect(b).not.toMatch(/^def list_suppliers\(/m)
      expect(b).toMatch(/^def list_orderlines|^def list_order_lines\(/m)
      // OData wire names and the filter helpers are exactly what the baseline emits.
      for (const w of ['$top', '$skip', '$filter', '_odata_filter(', '_odata_literal(']) expect(count(b, w), w).toBeGreaterThan(0)
      expect(count(b, '$top')).toBeLessThanOrEqual(count(a, '$top'))
      expect(b).toContain(a.slice(a.indexOf('def _odata_bad('), a.indexOf('def _odata_rows(')))
      expect(out.report.toolsDropped.some((d) => d.id === 'list_suppliers')).toBe(true)
      if (!hasPython) return
      const dir = mkdtempSync(join(tmpdir(), 'mcpgen-odata-prop-'))
      try {
        for (const f of ['server.py', 'test_server.py']) {
          const file = join(dir, f)
          writeFileSync(file, out.files.find((x) => x.path === f)!.content)
          const r = spawnSync('python3', ['-I', '-m', 'py_compile', file], { encoding: 'utf8' })
          expect(r.status, `${f}: ${r.stderr}`).toBe(0)
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('rejects a derived filter with the stable code odata-unsupported-op', async () => {
      const model = await load(name)
      const plan = buildPlan(model, {})
      const text = JSON.stringify({
        version: 1,
        baseline: { fingerprint: fingerprintOf(plan) },
        ops: [op('derived_filter', 'derived-1', { entity: plan.tools[0].entity, source: 'items', description: 'Find items by a nested key.' })],
      })
      const ev = evaluateProposals({ model, options: {}, text })
      expect(ev.ok).toBe(false)
      expect([...ev.fatal, ...ev.rejected].map((i) => i.code)).toContain('odata-unsupported-op')
      // The message says the limit is final and why, and the model has no nested collection to filter.
      const msg = [...ev.fatal, ...ev.rejected].find((i) => i.code === 'odata-unsupported-op')!.message
      expect(msg).toMatch(/final/)
      expect(msg).toMatch(/\$filter/)
      expect(model.entities.every((e) => e.nested.length === 0)).toBe(true)
    })

    it('the context pack example builder skips derived_filter on OData with the final reason', async () => {
      const model = await load(name)
      const plan = buildPlan(model, {})
      const ex = buildExamples(model, {}, [], plan, fingerprintOf(plan))
      expect(ex.examples.some((e) => e.op === 'derived_filter')).toBe(false)
      expect(ex.skipped.find((s) => s.op === 'derived_filter')?.reason).toMatch(/OData.*final/)
    })
  })
}
