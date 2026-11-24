// The tool step in front of the ifc-ebom-compiler (own design, deterministic, no I/O). Run by the app before every
// Try It Out job of that agent (src/lib/server/tryitout/preRunStep.ts), so the model never decides scope exclusions:
// - ELEMENTS gets a column `excluded_by`: the id of the first scope rule whose field holds exactly its value on that
//   row (the same matching as step 1 of decideElement in ./ebomJoin), or `-`;
// - a section `## RULES NOT TIED TO DATA` lists the rule lines that are not in the rule shape or name no ELEMENTS
//   column (or `none`). A well-formed rule that matches no element is tied; it just excludes nothing.
// `## RULES` is left as it is. An `excluded_by` column or a RULES NOT TIED TO DATA section already in the upload is
// replaced, never trusted. An upload the helper cannot read is returned unchanged (null).
import { EbomError, parseUpload, type ElementRow } from './ebomJoin'

export const EXCLUDED_BY = 'excluded_by'
export const UNTIED_HEADING = 'RULES NOT TIED TO DATA'

export interface PreparedUpload {
  text: string
  /** One line for the progress feed. */
  note: string
}

const heading = (l: string): string | null => (/^##\s/.test(l.trim()) ? l.trim().replace(/^##\s+/, '').trim().toUpperCase() : null)

export function prepareEbomUpload(text: string): PreparedUpload | null {
  const src = text.replace(/\r\n?/g, '\n').split('\n')
  // Drop an untied section the upload brought along, so the helper reads the upload as it will be sent.
  const kept: string[] = []
  let skipping = false
  for (const l of src) {
    const h = heading(l)
    if (h !== null) skipping = h === UNTIED_HEADING
    if (!skipping) kept.push(l)
  }
  let u
  try {
    u = parseUpload(kept.join('\n'))
  } catch (e) {
    if (e instanceof EbomError) return null
    throw e
  }
  const excludedBy = (e: ElementRow) => u.rules.find((r) => e[r.field as keyof ElementRow] === r.value)?.id ?? '-'
  const byToken = new Map(u.elements.map((e) => [e.token, excludedBy(e)]))

  const out: string[] = []
  let section: string | null = null
  let header: string[] | null = null
  let drop = -1
  for (const l of kept) {
    const h = heading(l)
    if (h !== null) {
      if (h === 'ELEMENTS') {
        out.push(l) // the section's lines follow
      } else {
        if (section === 'ELEMENTS') out.push(`## ${UNTIED_HEADING}`, ...(u.untiedRules.length ? u.untiedRules : ['none']))
        out.push(l)
      }
      section = h
      continue
    }
    if (section !== 'ELEMENTS' || l.trim() === '' || l.trim().startsWith('#')) {
      out.push(l)
      continue
    }
    const cells = l.split(',').map((c) => c.trim())
    if (!header) {
      header = cells
      drop = header.indexOf(EXCLUDED_BY)
      out.push([...header.filter((_, i) => i !== drop), EXCLUDED_BY].join(','))
      continue
    }
    const row = cells.filter((_, i) => i !== drop)
    const token = cells[header.indexOf('token')]
    out.push([...row, byToken.get(token) ?? '-'].join(','))
  }
  if (section === 'ELEMENTS') {
    while (out.length && out[out.length - 1].trim() === '') out.pop()
    out.push(`## ${UNTIED_HEADING}`, ...(u.untiedRules.length ? u.untiedRules : ['none']))
  }
  const hits = u.elements.filter((e) => byToken.get(e.token) !== '-').map((e) => `${e.token} ${byToken.get(e.token)}`)
  const note =
    `tool step: excluded_by worked out for ${u.elements.length} elements from ${u.rules.length} ${u.rules.length === 1 ? 'rule' : 'rules'}` +
    `${hits.length ? ` (${hits.join(', ')})` : ' (none excluded)'}; ${u.untiedRules.length} not tied to data`
  return { text: out.join('\n') + (text.endsWith('\n') ? '\n' : ''), note }
}
