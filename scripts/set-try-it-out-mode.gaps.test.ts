// E3: edge cases of scripts/set-try-it-out-mode.ts not covered by set-try-it-out-mode.test.ts.
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTryItOutMode } from './set-try-it-out-mode.js'

const dirs: string[] = []
function tmpDb(): string {
  const d = mkdtempSync(join(tmpdir(), 'mode-gaps-'))
  dirs.push(d)
  return join(d, 'c.db')
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function seed(path: string, rows: Array<{ slug: string; mode?: string; url?: string; tpl?: string }>) {
  const db = new Database(path)
  db.exec(`CREATE TABLE agents (
    slug TEXT PRIMARY KEY,
    try_it_out_mode TEXT NOT NULL DEFAULT 'none',
    try_it_out_url TEXT,
    try_it_out_task_template TEXT,
    title TEXT NOT NULL DEFAULT 't')`)
  const ins = db.prepare('INSERT INTO agents (slug, try_it_out_mode, try_it_out_url, try_it_out_task_template) VALUES (?,?,?,?)')
  for (const r of rows) ins.run(r.slug, r.mode ?? 'none', r.url ?? null, r.tpl ?? null)
  db.close()
}

function read(path: string) {
  const db = new Database(path, { readonly: true })
  const rows = db.prepare('SELECT slug, try_it_out_mode m, try_it_out_url u, try_it_out_task_template t, title FROM agents ORDER BY slug').all()
  db.close()
  return rows as Array<{ slug: string; m: string; u: string | null; t: string | null; title: string }>
}

describe('setTryItOutMode edge cases', () => {
  it('sets ABSOLUTE values: stale url and task template on the targeted rows are cleared', () => {
    const p = tmpDb()
    seed(p, [
      { slug: 'etim-classification-repair', mode: 'link', url: 'https://z', tpl: 'V' },
      { slug: 'qto-normalization', mode: 'link', url: 'https://q', tpl: 'W' },
      { slug: 'clash-prioritization', mode: 'link', url: 'https://c', tpl: 'X' },
      { slug: 'rfi-generation-from-findings', mode: 'link', url: 'https://r', tpl: 'Y' },
      { slug: 'product-sourcing-mbom', mode: 'link', url: 'https://p', tpl: 'Z' },
      { slug: 'quote-comparison', mode: 'link', url: 'https://qc', tpl: 'V' },
      { slug: 'carbon-epd-enrichment', mode: 'link', url: 'https://ce', tpl: 'W' },
      { slug: 'cut-sheet-qa', mode: 'link', url: 'https://cs', tpl: 'X' },
      { slug: 'spooling-and-cutting', mode: 'link', url: 'https://sc', tpl: 'Y' },
      { slug: 'd2-code-validation', mode: 'link', url: 'https://d2', tpl: 'D' },
      { slug: 'om-completeness', mode: 'link', url: 'https://om', tpl: 'O' },
      { slug: 'bms-digital-twin', mode: 'link', url: 'https://bms', tpl: 'B' },
      { slug: 'daily-report-cross-check', mode: 'link', url: 'https://drc', tpl: 'R' },
      { slug: 'punch-list-closure-check', mode: 'link', url: 'https://plc', tpl: 'L' },
      { slug: 'change-order-consistency-check', mode: 'link', url: 'https://coc', tpl: 'C' },
      { slug: 'safety-observation-classification', mode: 'link', url: 'https://soc', tpl: 'S' },
      { slug: 'procurement-lead-time-check', mode: 'link', url: 'https://plt', tpl: 'P' },
      { slug: 'material-delivery-check', mode: 'link', url: 'https://mdc', tpl: 'M' },
      { slug: 'qc-inspection-record-check', mode: 'link', url: 'https://qcr', tpl: 'Q' },
      { slug: 'warranty-register-check', mode: 'link', url: 'https://wrc', tpl: 'W' },
    ])
    setTryItOutMode(p)
    const rows = read(p)
    expect(rows.map((r) => [r.slug, r.m, r.u, r.t])).toEqual([
      ['bms-digital-twin', 'runnable', null, null],
      ['carbon-epd-enrichment', 'runnable', null, null],
      ['change-order-consistency-check', 'runnable', null, null],
      ['clash-prioritization', 'runnable', null, null],
      ['cut-sheet-qa', 'runnable', null, null],
      ['d2-code-validation', 'runnable', null, null],
      ['daily-report-cross-check', 'runnable', null, null],
      ['etim-classification-repair', 'runnable', null, null],
      ['material-delivery-check', 'runnable', null, null],
      ['om-completeness', 'runnable', null, null],
      ['procurement-lead-time-check', 'runnable', null, null],
      ['product-sourcing-mbom', 'runnable', null, null],
      ['punch-list-closure-check', 'runnable', null, null],
      ['qc-inspection-record-check', 'runnable', null, null],
      ['qto-normalization', 'runnable', null, null],
      ['quote-comparison', 'runnable', null, null],
      ['rfi-generation-from-findings', 'runnable', null, null],
      ['safety-observation-classification', 'runnable', null, null],
      ['spooling-and-cutting', 'runnable', null, null],
      ['warranty-register-check', 'runnable', null, null],
    ])
  })

  it('never touches rows other than the targeted targeted slugs', () => {
    const p = tmpDb()
    seed(p, [
      { slug: 'etim-classification-repair' },
      { slug: 'qto-normalization' },
      { slug: 'clash-prioritization' },
      { slug: 'rfi-generation-from-findings' },
      { slug: 'product-sourcing-mbom' },
      { slug: 'quote-comparison' },
      { slug: 'carbon-epd-enrichment' },
      { slug: 'cut-sheet-qa' },
      { slug: 'spooling-and-cutting' },
      { slug: 'd2-code-validation' },
      { slug: 'om-completeness' },
      { slug: 'bms-digital-twin' },
      { slug: 'daily-report-cross-check' },
      { slug: 'punch-list-closure-check' },
      { slug: 'change-order-consistency-check' },
      { slug: 'safety-observation-classification' },
      { slug: 'procurement-lead-time-check' },
      { slug: 'material-delivery-check' },
      { slug: 'qc-inspection-record-check' },
      { slug: 'warranty-register-check' },
      { slug: 'other-agent', mode: 'link', url: 'https://keep', tpl: 'keep' },
      { slug: 'demo-rfi-triage-2', mode: 'runnable' },
    ])
    setTryItOutMode(p)
    const other = read(p).filter((r) => r.slug === 'other-agent' || r.slug === 'demo-rfi-triage-2')
    expect(other.map((r) => [r.slug, r.m, r.u, r.t])).toEqual([
      ['demo-rfi-triage-2', 'runnable', null, null],
      ['other-agent', 'link', 'https://keep', 'keep'],
    ])
  })

  it('returns results in the declared order with one changed row each', () => {
    const p = tmpDb()
    seed(p, [{ slug: 'rfi-generation-from-findings' }, { slug: 'product-sourcing-mbom' }, { slug: 'quote-comparison' }, { slug: 'carbon-epd-enrichment' }, { slug: 'cut-sheet-qa' }, { slug: 'spooling-and-cutting' }, { slug: 'd2-code-validation' }, { slug: 'om-completeness' }, { slug: 'bms-digital-twin' }, { slug: 'daily-report-cross-check' }, { slug: 'punch-list-closure-check' }, { slug: 'change-order-consistency-check' }, { slug: 'safety-observation-classification' }, { slug: 'procurement-lead-time-check' }, { slug: 'material-delivery-check' }, { slug: 'qc-inspection-record-check' }, { slug: 'warranty-register-check' }, { slug: 'clash-prioritization' }, { slug: 'qto-normalization' }, { slug: 'etim-classification-repair' }])
    expect(setTryItOutMode(p)).toEqual([
      { slug: 'etim-classification-repair', mode: 'runnable', changes: 1 },
      { slug: 'qto-normalization', mode: 'runnable', changes: 1 },
      { slug: 'clash-prioritization', mode: 'runnable', changes: 1 },
      { slug: 'rfi-generation-from-findings', mode: 'runnable', changes: 1 },
      { slug: 'product-sourcing-mbom', mode: 'runnable', changes: 1 },
      { slug: 'quote-comparison', mode: 'runnable', changes: 1 },
      { slug: 'carbon-epd-enrichment', mode: 'runnable', changes: 1 },
      { slug: 'cut-sheet-qa', mode: 'runnable', changes: 1 },
      { slug: 'spooling-and-cutting', mode: 'runnable', changes: 1 },
      { slug: 'd2-code-validation', mode: 'runnable', changes: 1 },
      { slug: 'om-completeness', mode: 'runnable', changes: 1 },
      { slug: 'bms-digital-twin', mode: 'runnable', changes: 1 },
      { slug: 'daily-report-cross-check', mode: 'runnable', changes: 1 },
      { slug: 'punch-list-closure-check', mode: 'runnable', changes: 1 },
      { slug: 'change-order-consistency-check', mode: 'runnable', changes: 1 },
      { slug: 'safety-observation-classification', mode: 'runnable', changes: 1 },
      { slug: 'procurement-lead-time-check', mode: 'runnable', changes: 1 },
      { slug: 'material-delivery-check', mode: 'runnable', changes: 1 },
      { slug: 'qc-inspection-record-check', mode: 'runnable', changes: 1 },
      { slug: 'warranty-register-check', mode: 'runnable', changes: 1 },
    ])
  })

  it('an already-correct row still counts as one change (SQLite counts matched rows)', () => {
    const p = tmpDb()
    seed(p, [{ slug: 'etim-classification-repair', mode: 'runnable' }, { slug: 'qto-normalization', mode: 'runnable' }, { slug: 'clash-prioritization', mode: 'runnable' }, { slug: 'rfi-generation-from-findings', mode: 'runnable' }, { slug: 'product-sourcing-mbom', mode: 'runnable' }, { slug: 'quote-comparison', mode: 'runnable' }, { slug: 'carbon-epd-enrichment', mode: 'runnable' }, { slug: 'cut-sheet-qa', mode: 'runnable' }, { slug: 'spooling-and-cutting', mode: 'runnable' }, { slug: 'd2-code-validation', mode: 'runnable' }, { slug: 'om-completeness', mode: 'runnable' }, { slug: 'bms-digital-twin', mode: 'runnable' }, { slug: 'daily-report-cross-check', mode: 'runnable' }, { slug: 'punch-list-closure-check', mode: 'runnable' }, { slug: 'change-order-consistency-check', mode: 'runnable' }, { slug: 'safety-observation-classification', mode: 'runnable' }, { slug: 'procurement-lead-time-check', mode: 'runnable' }, { slug: 'material-delivery-check', mode: 'runnable' }, { slug: 'qc-inspection-record-check', mode: 'runnable' }, { slug: 'warranty-register-check', mode: 'runnable' }])
    expect(setTryItOutMode(p).map((r) => r.changes)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
  })

  it('a missing row throws naming that slug', () => {
    const p = tmpDb()
    seed(p, [{ slug: 'etim-classification-repair' }])
    expect(() => setTryItOutMode(p)).toThrow(/no row matched slug 'qto-normalization'.*ingest/)
  })

  it('OBSERVATION: the update is not transactional, so a missing second slug leaves the first row already updated', () => {
    const p = tmpDb()
    seed(p, [{ slug: 'etim-classification-repair', mode: 'link', url: 'https://x' }])
    expect(() => setTryItOutMode(p)).toThrow()
    const row = read(p)[0]
    expect(row.m).toBe('runnable') // partial application; harmless because values are absolute and re-run converges
    expect(row.u).toBeNull()
  })

  it('a database without the agents table throws a SQLite error and closes the handle (file stays usable)', () => {
    const p = tmpDb()
    new Database(p).close()
    expect(() => setTryItOutMode(p)).toThrow(/no such table|agents/)
    const db = new Database(p)
    db.exec('CREATE TABLE z (a)')
    db.close()
  })

  it('a missing database file is created empty by SQLite, then fails on the missing table', () => {
    const p = tmpDb()
    expect(existsSync(p)).toBe(false)
    expect(() => setTryItOutMode(p)).toThrow(/no such table/)
  })

  it('a path in a non-existent directory throws instead of creating directories', () => {
    expect(() => setTryItOutMode(join(tmpdir(), 'definitely-not-here-xyz', 'c.db'))).toThrow()
  })

  it('a case-differing slug does not match (slugs are exact)', () => {
    const p = tmpDb()
    seed(p, [{ slug: 'Etim-Classification-Repair' }, { slug: 'qto-normalization' }, { slug: 'clash-prioritization' }, { slug: 'rfi-generation-from-findings' }, { slug: 'product-sourcing-mbom' }, { slug: 'quote-comparison' }, { slug: 'carbon-epd-enrichment' }, { slug: 'cut-sheet-qa' }, { slug: 'spooling-and-cutting' }, { slug: 'd2-code-validation' }, { slug: 'om-completeness' }, { slug: 'bms-digital-twin' }, { slug: 'daily-report-cross-check' }, { slug: 'punch-list-closure-check' }])
    expect(() => setTryItOutMode(p)).toThrow(/etim-classification-repair/)
  })
})
