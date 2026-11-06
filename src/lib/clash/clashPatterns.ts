// Deterministic pattern grouping and findings table for the clash-prioritization hand-off (own code, no I/O).
// The Try It Out agent step only classifies each clash. A connected setup (or the engineer) runs this helper
// afterwards: open clashes that share an identical element text (element_a or element_b) form one pattern group.
// Groups are transitive (A shares with B, B shares with C -> one group). Label: PAT- plus the first clash_id in
// input order. Pattern groups and the findings table are built here, never by the model.

export const FINDINGS_HEADER =
  'finding_id | clash_ids | priority | disciplines | location | description | suggested_owner | open_question'
export const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const
export const CLOSED_STATUSES = ['resolved', 'approved', 'void']

export class ClashParseError extends Error {}

export interface ClashRow {
  clash_id: string
  discipline_a: string
  discipline_b: string
  element_a: string
  element_b: string
  level: string
  grid: string
  penetration_mm: string
  clash_type: string
  status: string
}

export interface Classified {
  clash_id: string
  status: string
  priority: string
  resolution_type: string
  responsible_discipline: string
}

export interface PatternGroup {
  pattern: string
  clash_ids: string[]
  shared_element: string
  priority: string
  suggested_resolution: string
}

export interface Finding {
  finding_id: string
  clash_ids: string[]
  priority: string
  disciplines: string[]
  location: string
  description: string
  suggested_owner: string
  open_question: string
}

const COLS = [
  'clash_id', 'discipline_a', 'discipline_b', 'element_a', 'element_b', 'level', 'grid', 'penetration_mm', 'clash_type', 'status',
] as const

export function parseClashCsv(text: string): ClashRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'))
  if (lines.length === 0) throw new ClashParseError('no CSV header found')
  const head = lines[0].split(',').map((s) => s.trim())
  for (const c of COLS) if (!head.includes(c)) throw new ClashParseError(`CSV header lacks column ${c}`)
  const rows = lines.slice(1).map((l, i) => {
    const cells = l.split(',').map((s) => s.trim())
    if (cells.length !== head.length) throw new ClashParseError(`CSV row ${i + 1} has ${cells.length} cells, expected ${head.length}`)
    return Object.fromEntries(head.map((h, j) => [h, cells[j]])) as unknown as ClashRow
  })
  const seen = new Set<string>()
  for (const r of rows) {
    if (seen.has(r.clash_id)) throw new ClashParseError(`duplicate clash_id ${r.clash_id} in CSV`)
    seen.add(r.clash_id)
  }
  return rows
}

// Reads the `clash_id | ...` pipe table of the agent result (columns found by header name).
export function parseClassifiedTable(text: string): Classified[] {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => l.includes('|') && l.split('|').map((s) => s.trim()).includes('clash_id'))
  if (start < 0) throw new ClashParseError('no pipe table with a clash_id column found in the agent result')
  const cut = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim())
  const head = cut(lines[start])
  const idx = (name: string) => {
    const i = head.indexOf(name)
    if (i < 0) throw new ClashParseError(`agent table lacks column ${name}`)
    return i
  }
  const [ci, si, pi, ri, di] = ['clash_id', 'status', 'priority', 'resolution_type', 'responsible_discipline'].map(idx)
  const out: Classified[] = []
  for (const l of lines.slice(start + 1)) {
    if (!l.includes('|')) break
    if (/^[-| :]+$/.test(l.trim())) continue
    const c = cut(l)
    if (c.length < head.length) throw new ClashParseError(`agent table row "${c[0]}" has ${c.length} cells, expected ${head.length}`)
    out.push({ clash_id: c[ci], status: c[si], priority: c[pi], resolution_type: c[ri], responsible_discipline: c[di] })
  }
  return out
}

const isOpen = (r: ClashRow) => !CLOSED_STATUSES.includes(r.status)

export function buildFindings(rows: ClashRow[], classified: Classified[]): { groups: PatternGroup[]; findings: Finding[] } {
  const byId = new Map(classified.map((c) => [c.clash_id, c]))
  if (classified.length !== rows.length || rows.some((r, i) => classified[i].clash_id !== r.clash_id)) {
    throw new ClashParseError(
      `agent table ids (${classified.map((c) => c.clash_id).join(',')}) do not equal the input ids (${rows.map((r) => r.clash_id).join(',')}) in order`,
    )
  }
  for (const r of rows.filter(isOpen)) {
    const c = byId.get(r.clash_id)!
    if (!(PRIORITIES as readonly string[]).includes(c.priority)) {
      throw new ClashParseError(`open clash ${r.clash_id} has priority "${c.priority}", expected one of ${PRIORITIES.join('/')}`)
    }
  }
  const open = rows.filter(isOpen)
  // union-find over open clashes sharing an element text
  const parent = new Map(open.map((r) => [r.clash_id, r.clash_id]))
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!)
      x = parent.get(x)!
    }
    return x
  }
  const owner = new Map<string, string>()
  for (const r of open) {
    for (const el of new Set([r.element_a, r.element_b])) {
      const o = owner.get(el)
      if (o === undefined) owner.set(el, r.clash_id)
      else parent.set(find(r.clash_id), find(o))
    }
  }
  const order = open.map((r) => r.clash_id)
  const members = new Map<string, ClashRow[]>()
  for (const r of open) {
    const root = find(r.clash_id)
    members.set(root, [...(members.get(root) ?? []), r])
  }
  const rank = (p: string) => (PRIORITIES as readonly string[]).indexOf(p)
  const groups: PatternGroup[] = []
  const findings: Finding[] = []
  const done = new Set<string>()
  for (const id of order) {
    const root = find(id)
    if (done.has(root)) continue
    done.add(root)
    const ms = members.get(root)!
    const first = ms[0]
    const cl = ms.map((m) => byId.get(m.clash_id)!)
    const priority = cl.map((c) => c.priority).sort((a, b) => rank(a) - rank(b))[0]
    const elements = [...new Set(ms.flatMap((m) => [m.element_a, m.element_b]))]
    const isGroup = ms.length > 1
    if (isGroup) {
      const counts = elements.filter((e) => ms.every((m) => m.element_a === e || m.element_b === e))
      groups.push({
        pattern: `PAT-${first.clash_id}`,
        clash_ids: ms.map((m) => m.clash_id),
        shared_element: counts[0] ?? elements.filter((e) => ms.filter((m) => m.element_a === e || m.element_b === e).length > 1).join('; '),
        priority,
        suggested_resolution: cl[0].resolution_type,
      })
    }
    const locs = new Set(ms.map((m) => `${m.level} grid ${m.grid}`))
    const missing = ms.filter((m) => m.penetration_mm === '').map((m) => m.clash_id)
    findings.push({
      finding_id: `F-${String(findings.length + 1).padStart(2, '0')}`,
      clash_ids: ms.map((m) => m.clash_id),
      priority,
      disciplines: [...new Set(ms.flatMap((m) => [m.discipline_a, m.discipline_b]))].sort(),
      location: locs.size === 1 ? [...locs][0] : 'various',
      description: `Clash between ${elements.join(', ')}; proposed: ${cl[0].resolution_type}`,
      suggested_owner: cl[0].responsible_discipline,
      open_question: missing.length ? `penetration missing for ${missing.join(', ')}` : 'none',
    })
  }
  return { groups, findings }
}

export function formatReport(groups: PatternGroup[], findings: Finding[]): string {
  const out = ['## Pattern groups', 'pattern | clash_ids | shared_element | priority | suggested_resolution | root_cause']
  if (groups.length === 0) out.push('none')
  for (const g of groups) {
    out.push(
      `${g.pattern} | ${g.clash_ids.join(', ')} | ${g.shared_element} | ${g.priority} | ${g.suggested_resolution} | same element in several clashes: ${g.shared_element}`,
    )
  }
  out.push('', '## Findings for RFI drafting', FINDINGS_HEADER)
  for (const f of findings) {
    out.push(
      `${f.finding_id} | ${f.clash_ids.join(', ')} | ${f.priority} | ${f.disciplines.join(', ')} | ${f.location} | ${f.description} | ${f.suggested_owner} | ${f.open_question}`,
    )
  }
  return out.join('\n')
}
