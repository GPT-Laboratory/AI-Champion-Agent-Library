// Review fix WR-11: fields the server under test controls are redacted and bounded in the report, and the size
// fallback re-checks the cap.
import { describe, expect, it } from 'vitest'
import { loadSuite } from './suite'
import { buildReport, MAX_NAME, MAX_REPORT_BYTES, MAX_TOOL_NAMES, ReportSchema, type BuildInput } from './report'
import { runSuite } from './runner'
import { fakeSubject } from './subjects'
import type { CheckResult } from './types'

const CANARY = 'canary-0123456789abcdef'
const base = (subject: Partial<BuildInput['subject']>): BuildInput => ({
  runId: 'r1',
  generatedAt: '2026-01-01T00:00:00Z',
  runtime: 'fake',
  runtimeLabel: 'fake',
  platformVersion: '0.1.0',
  reruns: 1,
  subject: { id: 'fake:x', kind: 'fake', transport: 'stdio', ...subject },
  cases: [],
  secrets: [CANARY]
})

describe('subject-controlled fields in buildReport', () => {
  it('masks the canary in tool names, server info and protocol version', () => {
    const r = buildReport(
      base({
        toolNames: [`get_${CANARY}`, 'plain_tool'],
        serverInfo: { name: `srv-${CANARY}`, version: `Bearer ${CANARY}` },
        protocolVersion: `v-${CANARY}`
      })
    )
    const json = JSON.stringify(r)
    expect(json).not.toContain(CANARY)
    expect(r.subject.toolNames).toEqual(['get_[redacted]', 'plain_tool'])
    expect(r.subject.serverInfo.name).toBe('srv-[redacted]')
    expect(r.subject.protocolVersion).toBe('v-[redacted]')
    expect(ReportSchema.safeParse(r).success).toBe(true)
  })

  it('caps the number and length of tool names and strips control characters', () => {
    const names = Array.from({ length: MAX_TOOL_NAMES + 100 }, (_, i) => `tool_${i}`)
    names[0] = 'x'.repeat(5000)
    names[1] = 'line1\nline2\u0000'
    const r = buildReport(base({ toolNames: names, serverInfo: { name: 'n'.repeat(1000), version: 'v'.repeat(1000) } }))
    expect(r.subject.toolNames).toHaveLength(MAX_TOOL_NAMES)
    expect(r.subject.toolNames[0].length).toBeLessThanOrEqual(MAX_NAME)
    expect(r.subject.toolNames[1]).toBe('line1 line2 ')
    expect(r.subject.serverInfo.name?.length).toBeLessThanOrEqual(MAX_NAME)
    expect(r.subject.serverInfo.version?.length).toBeLessThanOrEqual(MAX_NAME)
    expect(ReportSchema.safeParse(r).success).toBe(true)
  })

  it('leaves a long, legitimate snake_case tool name readable', () => {
    const name = 'get_catalog_item_by_supplier_identifier_v2'
    expect(name.length).toBeGreaterThan(32)
    expect(buildReport(base({ toolNames: [name] })).subject.toolNames).toEqual([name])
  })

  it('the schema rejects forged over-long or over-many names (container reports)', () => {
    const good = buildReport(base({ toolNames: ['a'] }))
    const long = { ...good, subject: { ...good.subject, toolNames: ['x'.repeat(MAX_NAME + 1)] } }
    const many = { ...good, subject: { ...good.subject, toolNames: Array(MAX_TOOL_NAMES + 1).fill('a') } }
    const info = { ...good, subject: { ...good.subject, serverInfo: { name: 'n'.repeat(MAX_NAME + 1) } } }
    for (const bad of [long, many, info]) expect(ReportSchema.safeParse(bad).success).toBe(false)
  })
})

describe('size fallback in runSuite', () => {
  it('re-checks the cap and never returns an over-cap report', async () => {
    const s = await loadSuite()
    if (!s.ok) throw new Error(s.errors.join('\n'))
    const sc = s.cases.find((c) => c.def.id === 'T2-CATALOG-API')!
    const checks: CheckResult[] = Array.from({ length: 14000 }, (_, i) => ({
      id: `extra_${i}`,
      kind: 'call',
      dimension: 'D2',
      status: 'PASS',
      boundBy: 'none',
      reason: 'r'.repeat(190)
    }))
    const subject = { ...fakeSubject('good'), prepare: async () => ({ status: 'PASS' as const, extraChecks: checks }) }
    const report = await runSuite({ subject, cases: [sc], runtime: 'fake' })
    expect(Buffer.byteLength(JSON.stringify(report), 'utf8')).toBeLessThanOrEqual(MAX_REPORT_BYTES)
    expect(ReportSchema.safeParse(report).success).toBe(true)
  })
})
