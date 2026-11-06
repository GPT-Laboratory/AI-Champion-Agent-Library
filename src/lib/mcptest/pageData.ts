// Data for the /mcp-test page. Lives here, not in +page.server.ts: SvelteKit rejects any export from a
// +page.server.ts other than load, actions and a few options, so the page answered 500 on every request.
import { FIDELITY } from './core/fidelity'
import { listSubjects } from './core/subjects'
import { caseBadge, type CaseInfo, type SubjectInfo } from './uiModel'

/** Case list from the fidelity table (no suite or file access). */
export function listCases(): CaseInfo[] {
  return FIDELITY.filter((e) => e.group === 'case').map((e) => ({
    id: e.id,
    tier: e.tier ?? 1,
    title: e.note,
    badge: caseBadge(e)
  }))
}

/**
 * Fake variants and generator samples are runnable through the API (generated servers are scored in
 * process, server-side cells are pending human). A real runtime subject is listed but disabled.
 */
export function listPageSubjects(): SubjectInfo[] {
  const known: SubjectInfo[] = listSubjects().map((s) => ({
    id: s.id,
    kind: s.kind,
    label: s.label,
    runnable: s.kind === 'fake' || s.kind === 'generator',
    ...(s.note ? { note: s.note } : {})
  }))
  known.push({
    id: 'real:runtime',
    kind: 'submitted',
    label: 'Real server (container or command)',
    runnable: false,
    note: 'Needs a real runtime that is not configured here; run it from the command line (pending human).'
  })
  return known
}
