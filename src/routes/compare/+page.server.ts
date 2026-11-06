// /compare (DISC-02, flag AGENT_COMPARE, default off): 404 when the flag is off, before anything is read.
// Only SvelteKit-recognised exports may live here (helpers are in $lib/compare).
import { error } from '@sveltejs/kit'
import { inArray } from 'drizzle-orm'
import { parseJsonArray, parseJsonStringArray } from '$lib/safeJson.js'
import { isMissingTableError } from '$lib/dbErrors.js'
import type { PageServerLoad } from './$types'
import { agentKindsEnabled } from '$lib/flags.js'
import { effectiveTryItOutMode } from '$lib/spec/kinds.js'
import { agentCompareEnabled } from '$lib/compareFlag.js'
import { db, agents } from '$lib/server/db.js'
import { MAX_COMPARE, buildCompareRows, parseCompareSlugs, type CompareAgentInput } from '$lib/compare.js'

export const load: PageServerLoad = async ({ url }) => {
  if (!agentCompareEnabled()) error(404, 'Not found')
  const { slugs, invalidCount, truncated } = parseCompareSlugs(url.searchParams.getAll('agents'))

  let rows: (typeof agents.$inferSelect)[] = []
  if (slugs.length) {
    try {
      rows = db.select().from(agents).where(inArray(agents.slug, slugs)).all()
    } catch (err) {
      // E6 (D-401): no tables yet (fresh checkout): every slug is simply unknown.
      if (!isMissingTableError(err)) throw err
    }
  }
  const bySlug = new Map(rows.map((r) => [r.slug, r]))
  const unknown = slugs.filter((s) => !bySlug.has(s))

  const kindsOn = agentKindsEnabled()
  const kindInfo =
    kindsOn && rows.length
      ? (await import('$lib/server/kinds.js')).loadKindInfo(db as never, rows.map((r) => r.slug))
      : null

  const found: CompareAgentInput[] = slugs.flatMap((s) => {
    const r = bySlug.get(s)
    if (!r) return []
    const k = kindInfo?.get(s)
    return [
      {
        slug: r.slug,
        title: r.title,
        summary: r.summary,
        category: r.category,
        tags: parseJsonStringArray(r.tags),
        llmName: r.llmName,
        llmTemperature: r.llmTemperature,
        toolNames: parseJsonStringArray(r.toolNames),
        inputFields: parseJsonArray(r.inputSchema),
        requiresHumanApproval: r.requiresHumanApproval,
        maturityStatus: r.maturityStatus,
        // Same rule as catalog and detail (WR-09): a non-agent kind never shows a runnable mode.
        tryItOutMode: kindsOn ? effectiveTryItOutMode(k?.kind ?? 'agent', r.tryItOutMode) : r.tryItOutMode,
        githubUrl: r.githubUrl,
        linkLabel: r.linkLabel,
        customizableFields: r.customizableFields ? parseJsonStringArray(r.customizableFields) : null,
        ...(kindsOn ? { kind: k?.kind ?? 'agent', framework: k?.framework ?? null } : {}),
      },
    ]
  })

  return {
    max: MAX_COMPARE,
    invalidCount,
    truncated,
    unknown,
    agents: found.map((a) => ({ slug: a.slug, title: a.title, kind: a.kind ?? null, framework: a.framework ?? null })),
    rows: buildCompareRows(found, { kinds: kindsOn }),
    kindsOn,
  }
}
