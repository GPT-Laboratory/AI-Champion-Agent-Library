// Subject registry: fake variants (scorer fixtures) plus the generator subjects of plan 15-09.
// Lives in core/ but, as allowed by the plan, imports ../fake and ../generatorSubject by relative path.
import { serveStdio } from '../fake/fakeServer'
import { startHttpFake } from '../fake/httpFake'
import { getVariant, VARIANTS, variantIds } from '../fake/variants'
import { generatorSubjects } from '../generatorSubject'
import type { CaseDef, PrepareResult, Subject } from './types'

export type PrepareWithStderr = PrepareResult & {
  /** Captured stderr of in-process serves (for the secret canary check). */
  stderrText?: () => string
}

export interface RunnableSubject extends Subject {
  prepare(c: CaseDef, workdir: string): Promise<PrepareWithStderr>
  /** Start an HTTP flavour of the subject on loopback; the runner closes it. */
  startHttp?(env: Record<string, string>): Promise<{ url: string; close(): Promise<void> }>
  /**
   * Optional per-case tool surface. A docs-only case is answered by a server built from the docs alone,
   * so the fake exposes only the documented tools there. null = all tools.
   */
  toolScope?(c: CaseDef): string[] | null
}

function groundingTools(c: CaseDef): string[] | null {
  const cfg = c.x['x-config']
  if (cfg && typeof cfg === 'object') {
    const g = (cfg as Record<string, unknown>).grounding
    if (g && typeof g === 'object') {
      const t = (g as Record<string, unknown>).traceTable
      if (t && typeof t === 'object') return Object.keys(t as object)
    }
  }
  return null
}

export function fakeSubject(variantId: string): RunnableSubject {
  return {
    id: `fake:${variantId}`,
    kind: 'fake',
    modality: 'any',
    llm: false,
    networkPolicy: 'loopback-only mock',
    status: 'installed',
    transports: ['stdio', 'http'],
    async prepare(): Promise<PrepareWithStderr> {
      if (!getVariant(variantId)) return { status: 'GEN_FAILED', error: `unknown fake variant: ${variantId.slice(0, 60)}` }
      const err: string[] = []
      return {
        status: 'PASS',
        launch: {
          kind: 'inproc',
          serve: (r, w, env) =>
            serveStdio(r as never, w as never, { variant: variantId, env, stderr: { write: (s: string) => err.push(s) } })
        },
        stderrText: () => err.join('')
      }
    },
    startHttp: (env) => startHttpFake({ variant: variantId, env, stderr: { write: () => {} } }),
    toolScope: (c) => groundingTools(c)
  }
}

export function listSubjects(): { id: string; kind: Subject['kind']; label: string; runnable: boolean; note?: string }[] {
  const out: { id: string; kind: Subject['kind']; label: string; runnable: boolean; note?: string }[] = []
  for (const id of variantIds()) {
    out.push({ id: `fake:${id}`, kind: 'fake', label: `Fake variant ${id} (scorer fixture)`, runnable: true, note: VARIANTS[id].description })
  }
  for (const g of generatorSubjects()) {
    out.push({
      id: g.id,
      kind: 'generator',
      label: `Generator subject ${g.id.slice('generator:'.length)}`,
      runnable: false,
      note: 'Generated Python servers are never executed here; runs report PENDING_HUMAN with generator-side checks scored.'
    })
  }
  return out
}

export function resolveSubject(id: string): RunnableSubject | null {
  if (typeof id !== 'string') return null
  if (id.startsWith('fake:')) {
    const v = id.slice('fake:'.length)
    return getVariant(v) ? fakeSubject(v) : null
  }
  const g = generatorSubjects().find((s) => s.id === id)
  return g ? (g as RunnableSubject) : null
}
