// Puts the scope rules a scope-rule-drafter result wrote into an ifc-ebom-compiler upload (client-safe, pure).
// Used by the "Use these rules in the IFC EBOM Compiler" hand-over (src/lib/handoff.ts) and, later, by the pipeline.
// The upload loses its `## RULE TEXT` section (the compiler does not read sentences) and gets the rule lines in its
// `## RULES` section: added after the rules it has ('add'; an earlier hand-over's text: rules are replaced) or
// instead of them ('replace'). With no `## RULES` section, one is put in front of `## ELEMENTS`.
import { RULE } from '../ebom/ebomJoin'

export type SpliceMode = 'add' | 'replace'

const heading = (l: string): string | null => (/^##\s/.test(l.trim()) ? l.trim().replace(/^##\s+/, '').trim().toUpperCase() : null)
const isLabel = (l: string) => /^#(\s|$)/.test(l.trim())
const ruleId = (l: string) => RULE.exec(l.trim())?.[1] ?? l.trim().split(':').slice(0, 2).join(':')

/** The rule lines under `## RULES` of a result ("none", fences and table rows left out). */
export function rulesBlockOf(result: string): string[] {
  const out: string[] = []
  let inRules = false
  for (const raw of result.split(/\r?\n/)) {
    const h = heading(raw)
    if (h !== null) {
      inRules = h === 'RULES'
      continue
    }
    const t = raw.trim()
    if (!inRules || t === '' || t === 'none' || t.startsWith('```') || t.startsWith('|') || isLabel(t)) continue
    out.push(t)
  }
  return out
}

/** The upload with RULE TEXT removed and the rule lines spliced into RULES. */
export function spliceRules(upload: string, lines: string[], mode: SpliceMode = 'add'): string {
  const src = upload.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let section: string | null = null
  // With a RULES section anywhere, the lines go there; otherwise into a new one in front of ELEMENTS (or at the end).
  let newSection = !src.some((l) => heading(l) === 'RULES')
  let existing: string[] = []
  const flushRules = () => {
    const kept = mode === 'replace' ? [] : existing.filter((l) => !ruleId(l).startsWith('text:'))
    out.push('## RULES', ...kept, ...lines)
  }
  for (const raw of src) {
    const h = heading(raw)
    if (h !== null) {
      if (section === 'RULES') flushRules()
      section = h
      if (h === 'RULES') {
        existing = []
        continue
      }
      if (h === 'ELEMENTS' && newSection) {
        flushRules()
        newSection = false
      }
      if (h === 'RULE TEXT') continue
      out.push(raw)
      continue
    }
    if (section === 'RULE TEXT') continue
    if (section === 'RULES') {
      if (raw.trim() !== '' && !isLabel(raw)) existing.push(raw.trim())
      continue
    }
    out.push(raw)
  }
  if (section === 'RULES') flushRules()
  if (newSection) flushRules()
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}
