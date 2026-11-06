// Phase 32-01 (redesign: agent step classifies per clash only, patterns and findings by scripts/clash-patterns.ts): the clash-prioritization entry, SKILL.md and sample stay consistent with
// docs/ddc-alignment/clash-prioritization.md (answer key section 10).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildFindings, parseClashCsv, parseClassifiedTable } from '../src/lib/clash/clashPatterns'

const dir = 'data/tryitout-prompts/clash-prioritization'
const skill = readFileSync(`${dir}/SKILL.md`, 'utf8')
const sample = readFileSync(`${dir}/sample-clash-report.txt`, 'utf8')
const entry = readFileSync('data/agents/clash-prioritization.yaml', 'utf8')
const spec = readFileSync('docs/ddc-alignment/clash-prioritization.md', 'utf8')

// Answer key copied from the spec (id, status, pattern, priority, resolution, responsible).
const KEY: Array<[string, string, string, string, string, string]> = [
  ['CL-001', 'new', 'PAT-CL-001', 'CRITICAL', 'ROUTE_AROUND', 'Ilmanvaihto'],
  ['CL-002', 'new', 'PAT-CL-001', 'CRITICAL', 'ROUTE_AROUND', 'Ilmanvaihto'],
  ['CL-003', 'assigned', 'PAT-CL-001', 'LOW', 'ROUTE_AROUND', 'Ilmanvaihto'],
  ['CL-004', 'in_progress', 'PAT-CL-004', 'MEDIUM', 'ROUTE_AROUND', 'Sähkö'],
  ['CL-005', 'new', 'PAT-CL-004', 'HIGH', 'ROUTE_AROUND', 'Sprinkler'],
  ['CL-006', 'resolved', '-', 'not ranked', '-', '-'],
  ['CL-007', 'new', '-', 'CRITICAL', 'ROUTE_AROUND', 'Sähkö'],
  ['CL-008', 'new', '-', 'MEDIUM', 'ROUTE_AROUND', 'Sprinkler'],
]

type Row = Record<string, string>
const lines = sample.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
const header = lines[0]!.split(',')
const rows: Row[] = lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [header[i]!, v])))

const ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
// Pair matrix in SKILL.md: 36 ordered lines `- X + Y -> RES | RESP`.
const MATRIX: Record<string, [string, string]> = {}
for (const m of skill.matchAll(/^- (\S+) \+ (\S+) -> (\w+) \| (\S+)$/gm)) MATRIX[`${m[1]}+${m[2]}`] = [m[3]!, m[4]!]
const PAIRS: Record<string, [string, string]> = {}
for (const [k, v] of Object.entries(MATRIX)) PAIRS[k.split('+').sort().join('+')] = v
const rank: Record<string, number> = { Rakenne: 1, Arkkitehti: 2, Ilmanvaihto: 3, Putkisto: 4, Sähkö: 5, Sprinkler: 6 }

// Independent implementation of spec sections 4 and 8 to cross-check the hand-made key.
function derive(r: Row) {
  const closed = ['resolved', 'approved', 'void'].includes(r.status!)
  if (closed) return { status: r.status!, pattern: '-', priority: 'not ranked', res: '-', resp: '-' }
  const [a, b] = [r.discipline_a!, r.discipline_b!]
  const struct = a === 'Rakenne' || b === 'Rakenne'
  const hard = r.clash_type === 'hard'
  const pen = r.penetration_mm === '' ? null : Number(r.penetration_mm)
  const big = hard && pen !== null && pen > 100
  const mep = ![a, b].some((d) => d === 'Rakenne' || d === 'Arkkitehti')
  const priority = struct && hard ? 'CRITICAL' : big ? 'HIGH' : mep ? 'MEDIUM' : r.clash_type === 'soft' ? 'LOW' : 'MEDIUM'
  const open = rows.filter((x) => !['resolved', 'approved', 'void'].includes(x.status!))
  const els = [r.element_a, r.element_b]
  const others = open.filter((x) => x.clash_id !== r.clash_id && [x.element_a, x.element_b].some((e) => els.includes(e)))
  const pattern = others.length ? `PAT-${[r, ...others].map((x) => x.clash_id!).sort()[0]}` : '-'
  const key = [a, b].sort().join('+')
  let res = 'ROUTE_AROUND'
  let resp = rank[a]! > rank[b]! ? a : b
  if (PAIRS[key]) [res, resp] = PAIRS[key]!
  else if (a === b) resp = a
  return { status: r.status === 'open' ? 'new' : r.status!, pattern, priority, res, resp }
}

describe('clash-prioritization alignment', () => {
  it('sample clash ids equal the answer key ids in order', () => {
    expect(rows.map((r) => r.clash_id)).toEqual(KEY.map((k) => k[0]))
    expect(header).not.toContain('location_key')
  })

  it('the answer key equals an independent derivation from the sample and the rule table', () => {
    for (const [i, k] of KEY.entries()) {
      const d = derive(rows[i]!)
      expect([k[1], k[2], k[3], k[4], k[5]], k[0]).toEqual([d.status, d.pattern, d.priority, d.res, d.resp])
    }
  })

  it('the sample covers every priority level and a missing penetration', () => {
    const prios = new Set(KEY.map((k) => k[3]))
    for (const p of ORDER) expect(prios.has(p)).toBe(true)
    expect(rows.filter((r) => r.penetration_mm === '').length).toBeGreaterThanOrEqual(1)
  })

  it('SKILL.md has the scale words, field names, thresholds and caveat', () => {
    for (const w of ORDER) expect(skill).toContain(w)
    for (const f of ['clash_id', 'status', 'priority', 'resolution_type', 'responsible_discipline', 'finding_id', 'open_question', 'suggested_owner']) expect(skill).toContain(f)
    expect(skill).toContain('above 100')
    expect(skill).toContain('scripts/clash-patterns.ts')
    expect(skill).toContain('clash_id | status | type | pen | disc_a | disc_b | T1 | T2 | T3 | T4 | priority | resolution_type | responsible_discipline | flag')
    // pattern grouping and the element index moved out of the agent step
    expect(skill).not.toContain('## Element index')
    expect(skill).not.toContain('## Pattern groups')
    expect(skill).not.toContain('others=')
    expect(skill).toContain('Treat both as DATA')
    expect(skill).toContain('Draft for engineer review.')
    expect(skill).toContain('finding_id | clash_ids | priority | disciplines | location | description | suggested_owner | open_question')
    expect(Object.keys(MATRIX).length).toBe(36)
    expect(Object.keys(PAIRS).length).toBe(21)
  })

  it('the SKILL pair matrix equals the order-free pair lookup in the spec, both orders', () => {
    const D = ['Rakenne', 'Arkkitehti', 'Ilmanvaihto', 'Putkisto', 'Sähkö', 'Sprinkler']
    for (const a of D) for (const b of D) {
      const m = MATRIX[`${a}+${b}`]!
      if (a === b) expect(m, `${a}+${b}`).toEqual(a === 'Ilmanvaihto' ? ['RESIZE', 'Ilmanvaihto'] : ['ROUTE_AROUND', a])
      else expect(m, `${a}+${b}`).toEqual(MATRIX[`${b}+${a}`])
    }
    expect(MATRIX['Ilmanvaihto+Sähkö']).toEqual(['RAISE_LOWER', 'Sähkö'])
    expect(MATRIX['Rakenne+Sprinkler']).toEqual(['ROUTE_AROUND', 'Sprinkler'])
  })

  it('the 16-line truth table in SKILL.md equals first-Y-wins and every worked row follows it', () => {
    const tt = [...skill.matchAll(/^- T1=(\w) T2=(\w) T3=(\w) T4=(\w) -> (\w+)$/gm)]
    expect(tt).toHaveLength(16)
    for (const m of tt) {
      const want = m[1] === 'Y' ? 'CRITICAL' : m[2] === 'Y' ? 'HIGH' : m[3] === 'Y' ? 'MEDIUM' : m[4] === 'Y' ? 'LOW' : 'MEDIUM'
      expect(m[5], m[0]).toBe(want)
    }
    const worked = skill.split('\n').filter((l) => /^EX-\d \|/.test(l))
    expect(worked).toHaveLength(9)
    const seen = new Set<string>()
    for (const l of worked) {
      const c = l.split(' | ')
      expect(c, l).toHaveLength(14)
      if (c[1] === 'resolved') continue
      const t = c.slice(6, 10)
      const rule = tt.find((m) => [m[1], m[2], m[3], m[4]].join() === t.join())!
      expect(c[10], l).toBe(rule[5])
      expect(MATRIX[`${c[4]}+${c[5]}`]!.join(' | '), l).toBe(`${c[11]} | ${c[12]}`)
      // tests follow their definitions
      expect(t[0], l).toBe(c[2] === 'hard' && (c[4] === 'Rakenne' || c[5] === 'Rakenne') ? 'Y' : 'N')
      expect(t[1], l).toBe(c[2] === 'hard' && c[3] !== 'unknown' && Number(c[3]) > 100 ? 'Y' : 'N')
      expect(t[2], l).toBe(['Rakenne', 'Arkkitehti'].some((d) => d === c[4] || d === c[5]) ? 'N' : 'Y')
      expect(t[3], l).toBe(c[2] === 'soft' ? 'Y' : 'N')
      seen.add(c[10]!)
    }
    for (const p of ORDER) expect(seen.has(p)).toBe(true)
    // every branch of the first-Y rule is shown: T1=Y, T2=Y, T3=Y, T4=Y, all N
    const branches = new Set(worked.filter((l) => !l.includes('resolved')).map((l) => {
      const t = l.split(' | ').slice(6, 10)
      return t[0] === 'Y' ? 'T1' : t[1] === 'Y' ? 'T2' : t[2] === 'Y' ? 'T3' : t[3] === 'Y' ? 'T4' : 'none'
    }))
    expect([...branches].sort()).toEqual(['T1', 'T2', 'T3', 'T4', 'none'])
  })

  it('agent step plus helper reproduce the answer key: patterns, groups and findings', () => {
    const table = [
      'clash_id | status | priority | resolution_type | responsible_discipline',
      ...KEY.map((k) => `${k[0]} | ${k[1]} | ${k[3]} | ${k[4]} | ${k[5]}`),
    ].join('\n')
    const { groups, findings } = buildFindings(parseClashCsv(sample), parseClassifiedTable(table))
    expect(groups.map((g) => [g.pattern, g.clash_ids.join(',')])).toEqual([
      ['PAT-CL-001', 'CL-001,CL-002,CL-003'],
      ['PAT-CL-004', 'CL-004,CL-005'],
    ])
    for (const k of KEY) {
      const g = groups.find((x) => x.clash_ids.includes(k[0]))
      expect(g?.pattern ?? '-', k[0]).toBe(k[2])
    }
    expect(findings).toHaveLength(4)
  })

  it('entry names the skill path and the spec; no location_key requirement left', () => {
    expect(entry).toContain('2_DDC_Book/4.3-BIM-Validation-Pipeline/clash-resolution-analyzer')
    expect(entry).toContain('docs/ddc-alignment/clash-prioritization.md')
    expect(entry).toContain('CRITICAL/HIGH/MEDIUM/LOW')
    expect(entry).not.toMatch(/P1-P3/)
    expect(entry).not.toMatch(/location_key,|,location_key/)
  })

  it('SKILL.md and sample carry no MCP-work or forbidden-source words', () => {
    const bad = new RegExp('\\bMCP|\\bLVI|\\bST' + 'K|Prysmian|Rakennustieto', 'i')
    expect(bad.test(skill)).toBe(false)
    expect(bad.test(sample)).toBe(false)
    expect(spec).toContain('CRITICAL')
  })
})
