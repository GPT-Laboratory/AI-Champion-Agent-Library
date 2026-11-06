// Human-readable review of an evaluated proposal file (`--validate-only`): what would change per tool,
// before and after, and which ops were applied or rejected and why. Presentation only. Free text from
// the proposal (reasons, descriptions) is cleaned and redacted before it is printed, and no rejected
// value is ever repeated (issue messages carry none).
import { redactSecrets } from '../redact.js'
import type { PlannedTool } from '../types.js'
import type { Evaluation } from './index.js'
import { baselineSignature, finalSignature } from './signature.js'

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3)}...` : s)
export function cleanLine(s: unknown, n = 160): string {
  const t = redactSecrets(String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim())
  return clip(t, n)
}

export function renderReview(ev: Evaluation): string {
  const out: string[] = []
  out.push(`Proposal review (${ev.mode} mode)`)
  out.push(`  proposal file sha256: ${ev.fileSha256}`)
  out.push(`  baseline fingerprint: ${ev.fingerprint}`)
  const failed = ev.fatal.length > 0 || (!ev.ok && ev.rejected.length > 0)
  out.push(`  result: ${ev.ok ? 'ACCEPTED' : 'REJECTED (nothing was applied)'}`)
  out.push('')
  if (ev.fatal.length > 0) {
    out.push('File-level problems:')
    for (const i of ev.fatal) out.push(`  - gate ${i.gate} ${i.code}: ${cleanLine(i.message, 300)}`)
    out.push('')
  }
  if (ev.rejected.length > 0) {
    out.push(ev.ok ? 'Rejected ops (skipped, lenient mode):' : 'Ops that failed a gate:')
    for (const i of ev.rejected) out.push(`  - ${i.opId}: gate ${i.gate} ${i.code}: ${cleanLine(i.message, 300)}`)
    out.push('')
  }
  if (!ev.plan) {
    if (!failed) out.push('No plan was produced.')
    out.push('Human review is required before any proposal-assisted package is published. Nothing was published or written.')
    return out.join('\n') + '\n'
  }
  out.push(`Applied ops (${ev.applied.length}):`)
  for (const o of ev.applied) {
    const reason = (o as { reason: string }).reason
    out.push(`  - ${o.id} [${o.op}]: ${cleanLine(reason, 200)}`)
  }
  out.push('')
  out.push('Changes per tool (before -> after):')
  const after = new Map<string, PlannedTool>()
  for (const t of [...ev.plan.tools, ...(ev.plan.internal ?? [])]) if (!t.proposed?.wrapper) after.set(t.proposed?.baseName ?? t.name, t)
  let changes = 0
  for (const b of ev.baseline.tools) {
    const a = after.get(b.name)
    const exposed = a ? ev.plan.tools.includes(a) : false
    const lines: string[] = []
    if (!a) lines.push('    removed: hidden by a proposal and not used by any other tool')
    else {
      if (!exposed) lines.push('    not offered to clients: now a private function used by a merged, split or composite tool (or hidden)')
      if (exposed && a.name !== b.name) lines.push(`    name: ${b.name} -> ${a.name}`)
      if (a.description !== b.description) lines.push(`    description: before: ${cleanLine(b.description, 200)}`, `                 after:  ${cleanLine(a.description, 200)}`)
      const sb = baselineSignature(ev.baseline, b)
      const sa = finalSignature(ev.plan, a)
      const fmt = (list: typeof sb) => list.map((x) => `${x.name}${x.default !== undefined ? `=${typeof x.default === 'string' ? JSON.stringify(x.default) : String(x.default)}` : x.required ? '' : '?'}`).join(', ')
      if (fmt(sb) !== fmt(sa)) lines.push(`    arguments: before: (${fmt(sb)})`, `               after:  (${fmt(sa)})`)
      for (const [arg, e] of Object.entries(a.proposed?.args ?? {})) {
        if (e.pin !== undefined) lines.push(`    pinned: ${arg} = ${cleanLine(typeof e.pin === 'string' ? JSON.stringify(e.pin) : String(e.pin), 60)} (not an argument any more)`)
        if (e.keepAlias && e.name) lines.push(`    alias kept: ${arg} still accepted next to ${e.name}`)
        if (e.description !== undefined) lines.push(`    argument ${arg} described: ${cleanLine(e.description, 120)}`)
      }
      if (a.projection.join(',') !== b.projection.join(',')) lines.push(`    default fields: ${b.projection.join(', ')} -> ${a.projection.join(', ')}`)
    }
    if (lines.length > 0) {
      changes++
      out.push(`  ${b.name}`, ...lines)
    }
  }
  const created = ev.plan.tools.filter((t) => t.proposed?.wrapper || t.derived?.origin === 'proposed')
  for (const t of created) {
    changes++
    const w = t.proposed?.wrapper
    out.push(`  NEW ${t.name}${w ? ` (${w.kind}${w.kind === 'merge' ? ` ${w.mode}` : ''})` : ' (derived filter)'}`, `    description: ${cleanLine(t.description, 240)}`)
    if (w) {
      out.push(`    arguments: (${w.params.map((p) => `${p.name}${p.required ? '' : '?'}`).join(', ')})`)
      if (w.kind === 'merge') out.push(`    calls: ${w.sources.map((s) => `${s.value} -> ${s.tool}`).join('; ')}`)
      if (w.kind === 'split') out.push(`    calls: ${w.base} with ${Object.entries(w.fixed).map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : String(v)}`).join(', ')}`)
      if (w.kind === 'composite') out.push(`    steps: ${w.steps.map((s) => `${s.id} -> ${s.tool}${s.forEach ? ` (for each, at most ${s.forEach.max})` : ''}`).join('; ')}; at most ${w.totalCalls} read-only calls`)
    }
  }
  if (changes === 0) out.push('  (no tool changes)')
  out.push('')
  out.push(`Tools offered after applying (${ev.plan.tools.length}): ${ev.plan.tools.map((t) => t.name).join(', ')}`)
  out.push('')
  out.push('Human review is required before any proposal-assisted package is published. Nothing was published.')
  return out.join('\n') + '\n'
}
