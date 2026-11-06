import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runCli } from './clash-patterns'
import {
  ClashParseError,
  FINDINGS_HEADER,
  buildFindings,
  parseClashCsv,
  parseClassifiedTable,
} from '../src/lib/clash/clashPatterns'

const sample = readFileSync('data/tryitout-prompts/clash-prioritization/sample-clash-report.txt', 'utf8')

const RESULT = `## Per-clash rows
clash_id | status | T1 | T2 | priority | resolution_type | responsible_discipline | note
--- | --- | --- | --- | --- | --- | --- | ---
CL-001 | new | Y | Y | CRITICAL | ROUTE_AROUND | Ilmanvaihto | x
CL-002 | new | Y | N | CRITICAL | ROUTE_AROUND | Ilmanvaihto | x
CL-003 | assigned | N | N | LOW | ROUTE_AROUND | Ilmanvaihto | x
CL-004 | in_progress | N | N | MEDIUM | ROUTE_AROUND | Sähkö | x
CL-005 | new | N | Y | HIGH | ROUTE_AROUND | Sprinkler | x
CL-006 | resolved | - | - | not ranked | - | - | closed
CL-007 | new | Y | N | CRITICAL | ROUTE_AROUND | Sähkö | x
CL-008 | new | N | N | MEDIUM | ROUTE_AROUND | Sprinkler | x

Draft for engineer review.
`

describe('clash patterns helper', () => {
  it('parses the sample CSV and the agent table', () => {
    expect(parseClashCsv(sample).map((r) => r.clash_id)).toEqual(['CL-001', 'CL-002', 'CL-003', 'CL-004', 'CL-005', 'CL-006', 'CL-007', 'CL-008'])
    const c = parseClassifiedTable(RESULT)
    expect(c).toHaveLength(8)
    expect(c[4]).toEqual({ clash_id: 'CL-005', status: 'new', priority: 'HIGH', resolution_type: 'ROUTE_AROUND', responsible_discipline: 'Sprinkler' })
  })

  it('groups open clashes by identical element text, takes the highest priority and excludes closed rows', () => {
    const { groups, findings } = buildFindings(parseClashCsv(sample), parseClassifiedTable(RESULT))
    expect(groups).toEqual([
      { pattern: 'PAT-CL-001', clash_ids: ['CL-001', 'CL-002', 'CL-003'], shared_element: 'Supply duct SD-12', priority: 'CRITICAL', suggested_resolution: 'ROUTE_AROUND' },
      { pattern: 'PAT-CL-004', clash_ids: ['CL-004', 'CL-005'], shared_element: 'Riser RS-3', priority: 'HIGH', suggested_resolution: 'ROUTE_AROUND' },
    ])
    expect(findings.map((f) => [f.finding_id, f.clash_ids.join('+'), f.priority])).toEqual([
      ['F-01', 'CL-001+CL-002+CL-003', 'CRITICAL'],
      ['F-02', 'CL-004+CL-005', 'HIGH'],
      ['F-03', 'CL-007', 'CRITICAL'],
      ['F-04', 'CL-008', 'MEDIUM'],
    ])
    expect(findings[0].disciplines).toEqual(['Ilmanvaihto', 'Rakenne'])
    expect(findings[0].location).toBe('various')
    expect(findings[1].location).toBe('L1 grid E/2')
    expect(findings[1].suggested_owner).toBe('Sähkö')
    expect(findings[2].open_question).toBe('penetration missing for CL-007')
    expect(findings[3].open_question).toBe('none')
    expect(findings.flatMap((f) => f.clash_ids)).not.toContain('CL-006')
  })

  it('a closed clash never joins a group', () => {
    const csv = `clash_id,discipline_a,discipline_b,element_a,element_b,level,grid,penetration_mm,clash_type,status
X-1,Sähkö,Putkisto,Tray T1,Pipe P1,L1,A/1,10,soft,open
X-2,Sähkö,Putkisto,Tray T1,Pipe P2,L1,A/1,10,soft,void
`
    const res = `clash_id | status | priority | resolution_type | responsible_discipline
X-1 | new | MEDIUM | ROUTE_AROUND | Sähkö
X-2 | void | not ranked | - | -
`
    const { groups, findings } = buildFindings(parseClashCsv(csv), parseClassifiedTable(res))
    expect(groups).toEqual([])
    expect(findings).toHaveLength(1)
  })

  it('groups are transitive and labelled by the first id in input order', () => {
    const csv = `clash_id,discipline_a,discipline_b,element_a,element_b,level,grid,penetration_mm,clash_type,status
Y-1,Sähkö,Putkisto,A,B,L1,A/1,10,soft,open
Y-2,Sähkö,Putkisto,C,D,L1,A/1,10,soft,open
Y-3,Sähkö,Putkisto,B,C,L1,A/1,10,soft,open
`
    const res = `clash_id | status | priority | resolution_type | responsible_discipline
Y-1 | new | LOW | ROUTE_AROUND | Sähkö
Y-2 | new | HIGH | ROUTE_AROUND | Sähkö
Y-3 | new | MEDIUM | ROUTE_AROUND | Sähkö
`
    const { groups } = buildFindings(parseClashCsv(csv), parseClassifiedTable(res))
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ pattern: 'PAT-Y-1', clash_ids: ['Y-1', 'Y-2', 'Y-3'], priority: 'HIGH' })
  })

  it('rejects an agent table with a missing, reordered or invalid row', () => {
    const rows = parseClashCsv(sample)
    const c = parseClassifiedTable(RESULT)
    expect(() => buildFindings(rows, c.slice(1))).toThrow(ClashParseError)
    expect(() => buildFindings(rows, [c[1], c[0], ...c.slice(2)])).toThrow(/in order/)
    expect(() => buildFindings(rows, c.map((x) => (x.clash_id === 'CL-001' ? { ...x, priority: 'P1' } : x)))).toThrow(/priority/)
    expect(() => parseClassifiedTable('no table here')).toThrow(ClashParseError)
    expect(() => parseClashCsv('a,b\n1,2')).toThrow(/lacks column/)
  })

  it('CLI report has both sections and the exact findings header; errors give exit 2', () => {
    const ok = runCli(sample, RESULT)
    expect(ok.code).toBe(0)
    expect(ok.out).toContain('## Pattern groups')
    expect(ok.out).toContain(FINDINGS_HEADER)
    expect(ok.out).toContain('F-01 | CL-001, CL-002, CL-003 | CRITICAL | Ilmanvaihto, Rakenne | various | Clash between Supply duct SD-12, Beam B-L2-04, Beam B-L2-05, Beam B-L2-07; proposed: ROUTE_AROUND | Ilmanvaihto | none')
    expect(ok.out).toContain('PAT-CL-004 | CL-004, CL-005 | Riser RS-3 | HIGH | ROUTE_AROUND | same element in several clashes: Riser RS-3')
    expect(runCli(sample, 'nothing').code).toBe(2)
  })
})
