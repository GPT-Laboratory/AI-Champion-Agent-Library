// Review fix WR-08: report and diagnostics ordering is by code unit, never by locale.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cmp, formatGaps } from './diagnostics'
import { buildReport } from './report'
import { buildPlan } from './plan'
import { acmeHttp } from './testing/sample-models'
import type { Gap } from './types'

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('cmp', () => {
  it('orders by UTF-16 code unit: upper case before lower case, punctuation by code', () => {
    expect(['b', 'B', 'a', 'A', '_', '-', 'ä', 'Z'].sort(cmp)).toEqual(['-', 'A', 'B', 'Z', '_', 'a', 'b', 'ä'])
    expect(cmp('a', 'a')).toBe(0)
    expect(cmp('a', 'b')).toBe(-1)
    expect(cmp('b', 'a')).toBe(1)
  })
})

describe('deterministic order', () => {
  it('toolsDropped and envVars do not depend on the default locale ordering', () => {
    const model = {
      ...acmeHttp,
      writeOperationsDropped: ['b_op', 'B_op', 'a_op', 'A_op', 'ä_op', '_op', 'z-op'],
    }
    const plan = buildPlan(model)
    const ids = buildReport(plan).toolsDropped.map((d) => d.id)
    expect(ids).toEqual([...ids].sort(cmp))
    // localeCompare would put 'a_op' before 'B_op'; code-unit order puts every capital first.
    expect(ids.indexOf('B_op')).toBeLessThan(ids.indexOf('a_op'))
    expect(ids).toEqual(['A_op', 'B_op', '_op', 'a_op', 'b_op', 'z-op', 'ä_op'])
  })
  it('formatGaps sorts equal severities by code unit', () => {
    const gaps: Gap[] = [
      { code: 'b-code', message: 'm', severity: 'warn' },
      { code: 'B-code', message: 'm', severity: 'warn' },
      { code: 'a-code', message: 'm', severity: 'warn' },
    ]
    expect(formatGaps(gaps).split('\n').map((l) => l.split(' ')[1].replace(':', ''))).toEqual(['B-code', 'a-code', 'b-code'])
  })
  it('no module of the generator orders anything with localeCompare', () => {
    for (const f of ['./report.ts', './diagnostics.ts', './plan.ts', './generate.ts', './registry.ts', './adapters/openapi.ts', './adapters/sql-ddl.ts', './adapters/tabular-catalog.ts']) {
      expect(src(f), f).not.toContain('localeCompare')
    }
  })
})
