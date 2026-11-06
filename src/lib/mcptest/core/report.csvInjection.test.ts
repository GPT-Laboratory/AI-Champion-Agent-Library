// Review fix IN-03: the legacy CSV row never emits a cell that a spreadsheet would evaluate as a formula.
import { describe, expect, it } from 'vitest'
import { buildReport, toLegacyCsvRow } from './report'

const row = (id: string, tools: string[]) =>
  toLegacyCsvRow(
    buildReport({
      runId: 'r',
      generatedAt: '2026-01-01T00:00:00Z',
      runtime: 'fake',
      runtimeLabel: 'fake',
      platformVersion: '0.1.0',
      reruns: 1,
      subject: { id, kind: 'fake', transport: 'stdio', toolNames: tools },
      cases: []
    })
  )

describe('toLegacyCsvRow formula safety', () => {
  it('prefixes leading = + - @ in the subject id and the tool names', () => {
    for (const lead of ['=', '+', '-', '@']) {
      const r = row(`${lead}cmd`, [`${lead}tool`])
      expect(r.startsWith(`'${lead}cmd,`)).toBe(true)
      expect(r).toContain(`'${lead}tool`)
    }
  })
  it('leaves ordinary values and quoting alone', () => {
    expect(row('fake:good', ['a', 'b']).startsWith('fake:good,')).toBe(true)
    expect(row('x', ['a,b'])).toContain('"a,b"')
  })
})
