// Hand-over of one agent's result to another agent's Try It Out panel, in the browser (docs/tryitout-example.md).
// The sending panel builds the next agent's upload (e.g. the scope rules spliced into the E-BOM data), keeps it in
// sessionStorage and opens the other agent's page; that panel takes it once and attaches it as its file. Nothing is
// sent to the server and nothing goes into the URL.
import { rulesBlockOf, spliceRules } from './rules/splice'

export interface Handoff {
  /** Slug of the receiving agent. */
  to: string
  /** Button text on the sending panel. */
  label: string
  /** The receiving agent's upload and a note for its panel, or null when the result has nothing to hand over. */
  build: (upload: string, result: string) => { fileName: string; text: string; note: string } | null
}

export const HANDOFFS: ReadonlyMap<string, Handoff> = new Map<string, Handoff>([
  [
    'scope-rule-drafter',
    {
      to: 'ifc-ebom-compiler',
      label: 'Use these rules in the IFC EBOM Compiler',
      build: (upload, result) => {
        const lines = rulesBlockOf(result)
        // The rules go into E-BOM data; without its ELEMENTS section (e.g. a run with no file) there is nothing to hand.
        if (lines.length === 0 || !/^##\s+ELEMENTS\s*$/im.test(upload)) return null
        return {
          fileName: 'ebom-upload-with-rules.txt',
          text: spliceRules(upload, lines, 'add'),
          note: `From the Scope Rule Drafter: ${lines.length} ${lines.length === 1 ? 'rule' : 'rules'} added to ## RULES of the upload (its sentences removed).`,
        }
      },
    },
  ],
])

export interface HandoffPayload {
  from: string
  to: string
  fileName: string
  text: string
  note: string
  at: number
}

export const HANDOFF_KEY = 'aic-tryitout-handoff'
/** A hand-over older than this is ignored (e.g. a tab reopened the next day). */
export const HANDOFF_MAX_AGE_MS = 60 * 60 * 1000
const MAX_TEXT = 200 * 1024

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const session = (): Store | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/** Stores the hand-over; false when the browser keeps no session storage. */
export function storeHandoff(p: HandoffPayload, store: Store | null = session()): boolean {
  if (!store || p.text.length > MAX_TEXT) return false
  try {
    store.setItem(HANDOFF_KEY, JSON.stringify(p))
    return true
  } catch {
    return false
  }
}

/** The hand-over for this agent, removed once read; null when there is none, it is for another agent, stale or broken. */
export function takeHandoff(agentId: string, store: Store | null = session(), now = Date.now()): HandoffPayload | null {
  if (!store) return null
  let p: Partial<HandoffPayload>
  try {
    const raw = store.getItem(HANDOFF_KEY)
    if (!raw) return null
    p = JSON.parse(raw)
  } catch {
    store.removeItem(HANDOFF_KEY)
    return null
  }
  if (p.to !== agentId) return null
  store.removeItem(HANDOFF_KEY)
  const ok =
    typeof p.from === 'string' &&
    typeof p.fileName === 'string' &&
    typeof p.text === 'string' &&
    typeof p.note === 'string' &&
    typeof p.at === 'number' &&
    p.text.length <= MAX_TEXT &&
    now - p.at >= 0 &&
    now - p.at <= HANDOFF_MAX_AGE_MS
  return ok ? (p as HandoffPayload) : null
}

/** Opens the receiving agent's page with its Try It Out panel open. */
export function openAgentPage(slug: string): void {
  window.location.assign(`/agents/${encodeURIComponent(slug)}?tryout=1`)
}
