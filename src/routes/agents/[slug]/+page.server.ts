import { db, agents } from '$lib/server/db.js'
import { eq, inArray } from 'drizzle-orm'
import { error } from '@sveltejs/kit'
import { parseJsonArray, parseJsonStringArray } from '$lib/safeJson.js'
import { isMissingTableError } from '$lib/dbErrors.js'
import type { PageServerLoad } from './$types'
import { warmForSession } from '$lib/server/tryitout/service'
import { related } from '$lib/server/search/index.js'
import { sessionKey } from '$lib/server/tryitout/session'
import { agentKindsEnabled } from '$lib/flags.js'
import { mcpGeneratorData, mcpTesterData, specViewerData } from '$lib/pageFlags.js'
import { defaultKindInfo, effectiveTryItOutMode } from '$lib/spec/kinds.js'

export const load: PageServerLoad = async ({ params, url, locals, cookies, getClientAddress }) => {
  let row: typeof agents.$inferSelect | undefined
  try {
    row = db
      .select()
      .from(agents)
      .where(eq(agents.slug, params.slug))
      .get()
  } catch (err) {
    // E6 (D-401): no tables yet (fresh checkout): there is no such agent, answer 404 rather than 500.
    if (!isMissingTableError(err)) throw err
  }

  if (!row) {
    error(404, 'Agent not found. It may have been removed or the URL is incorrect.')
  }

  // Phase 13 (flag AGENT_KINDS, default off): kind sidecar. Flag off: nothing below runs.
  const kindsOn = agentKindsEnabled()
  // Lazy import: flag-off never loads the sidecar reader (and its schema import).
  const kindInfo = kindsOn
    ? ((await import('$lib/server/kinds.js')).loadKindInfo(db as never, [row.slug]).get(row.slug) ?? defaultKindInfo())
    : null
  // Non-agent kinds (systems, skills, ...) are never runnable; 'external' links stay.
  const effectiveMode = kindInfo ? effectiveTryItOutMode(kindInfo.kind, row.tryItOutMode) : row.tryItOutMode

  // D-05: warm the visitor's container in the background; never awaited, never fatal.
  if (effectiveMode === 'runnable') {
    let clientKey: string | undefined
    try {
      clientKey = getClientAddress?.()
    } catch {
      clientKey = undefined
    }
    // WR-07: warmForSession caps new anonymous sessions per client address.
    void warmForSession(sessionKey({ locals, cookies, url }), row.slug, clientKey).catch(() => {})
  }

  // DISC-01: up to 4 related agents. Best effort; a failure must never break the detail page.
  let relatedAgents: { slug: string; title: string; summary: string; category: string | null }[] = []
  try {
    const hits = await related(row.slug, 4)
    const ids = hits.map((h) => h.slug).filter((s) => s !== row.slug)
    if (ids.length > 0) {
      const found = db
        .select({ slug: agents.slug, title: agents.title, summary: agents.summary, category: agents.category })
        .from(agents)
        .where(inArray(agents.slug, ids))
        .all()
      const bySlug = new Map(found.map((f) => [f.slug, f]))
      relatedAgents = ids.flatMap((id) => bySlug.get(id) ?? []).slice(0, 4)
    }
  } catch {
    relatedAgents = []
  }

  const { inputSchema, ...agentRow } = row

  const base = {
    agent: {
      ...agentRow,
      ...(effectiveMode !== row.tryItOutMode ? { tryItOutMode: effectiveMode } : {}),
      toolNames: parseJsonStringArray(row.toolNames),
      inputFields: parseJsonArray(inputSchema),
      tags: parseJsonStringArray(row.tags),
      fixedFields: parseJsonStringArray(row.fixedFields),
      customizableFields: row.customizableFields ? parseJsonStringArray(row.customizableFields) : null,
    },
    related: relatedAgents,
    openTryOut: url?.searchParams.get('tryout') === '1',
    ...mcpGeneratorData(),
    ...mcpTesterData(),
  }
  // UI-04 (flag UI_SPEC_VIEWER): adds the `specViewer` key only when on; flag off adds nothing.
  const full = { ...base, ...specViewerData(base.agent) }
  if (!kindInfo) return full
  // extras are never sent to the client.
  const { kind, framework, topology, members, sourceFormat } = kindInfo
  return { ...full, kindInfo: { kind, framework, topology, members, sourceFormat } }
}
