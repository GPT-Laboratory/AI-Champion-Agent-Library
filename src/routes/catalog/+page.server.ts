import { db, agents } from '$lib/server/db.js'
import { eq, and, asc, inArray } from 'drizzle-orm'
import { search } from '$lib/server/search/index.js'
import { parsePage, parseKind } from '$lib/catalogUrl'
import { agentKindsEnabled } from '$lib/flags.js'
import { catalogCompareData } from '$lib/compare.js'
import { effectiveTryItOutMode } from '$lib/spec/kinds.js'
import { parseJsonArray, parseJsonStringArray } from '$lib/safeJson.js'
import { isMissingTableError } from '$lib/dbErrors.js'
import { emptyCatalogData } from '$lib/catalogEmpty.js'
import type { PageServerLoad } from './$types'

const PAGE_SIZE = 24
const SLUG_CHUNK = 500

const loadCatalog: PageServerLoad = async ({ url }) => {
  const page = parsePage(url.searchParams.get('page'))
  const category = url.searchParams.get('category') ?? null
  const llm = url.searchParams.get('llm') ?? null
  const maturity = url.searchParams.get('maturity') ?? null
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200) || null

  // Phase 13: everything kind-related is gated; with the flag off no extra db call is made.
  const kindsOn = agentKindsEnabled()
  const kindsMod = kindsOn ? await import('$lib/server/kinds.js') : null
  // Allow-list validated: unknown values are ignored and never reach a query.
  const kind = kindsOn ? parseKind(url.searchParams.get('kind')) : null
  const kindSlugs: Set<string> | null =
    kindsMod && kind ? (kindsMod.listSlugsByKind(db as never, kind) ?? new Set<string>()) : null
  // Small kind sets are pushed into SQL; larger ones are filtered in memory (correctness over speed).
  const kindInSql = kindSlugs !== null && kindSlugs.size > 0 && kindSlugs.size <= SLUG_CHUNK
  const kindInMemory = kindSlugs !== null && kindSlugs.size > SLUG_CHUNK
  const kindEmpty = kindSlugs !== null && kindSlugs.size === 0

  const conditions = []
  if (category) conditions.push(eq(agents.category, category))
  if (llm) conditions.push(eq(agents.llmName, llm))
  if (maturity) conditions.push(eq(agents.maturityStatus, maturity))
  if (kindInSql) conditions.push(inArray(agents.slug, [...kindSlugs!]))

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  // Deserialize JSON arrays stored as text columns
  const toAgent = (row: typeof agents.$inferSelect) => {
    const { inputSchema, ...agentRow } = row
    return {
      ...agentRow,
      toolNames: parseJsonStringArray(row.toolNames),
      inputFields: parseJsonArray(inputSchema),
      tags: parseJsonStringArray(row.tags),
    }
  }

  let agentList: ReturnType<typeof toAgent>[]
  let total: number
  let searchDegraded = false

  if (q) {
    let slugs: string[] | null
    try {
      // Rank everything (no top-N cut): filters and pagination happen afterwards, so
      // a filtered query must not lose matches that rank below the default cut-off.
      const { results } = await search(q, { limit: Infinity })
      slugs = results.map((r) => r.slug)
    } catch (err) {
      // A broken search dependency must degrade search, not take down browsing.
      console.error('Catalog search failed; falling back to basic text match', err)
      searchDegraded = true
      slugs = null
    }

    if (kindSlugs && slugs) slugs = slugs.filter((s) => kindSlugs.has(s))

    if (slugs === null) {
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
      const matched = db
        .select()
        .from(agents)
        .where(whereClause)
        .all()
        .filter((row) => !kindSlugs || kindSlugs.has(row.slug))
        .filter((row) => {
          const hay = `${row.title} ${row.summary} ${row.category ?? ''} ${row.tags}`.toLowerCase()
          return terms.every((t) => hay.includes(t))
        })
        .sort((a, b) => a.title.localeCompare(b.title))
      total = matched.length
      agentList = matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(toAgent)
    } else if (slugs.length === 0) {
      agentList = []
      total = 0
    } else {
      // Chunk the IN list to stay far below SQLite's bound-variable limit.
      const matched: (typeof agents.$inferSelect)[] = []
      for (let i = 0; i < slugs.length; i += SLUG_CHUNK) {
        matched.push(
          ...db
            .select()
            .from(agents)
            .where(and(inArray(agents.slug, slugs.slice(i, i + SLUG_CHUNK)), ...conditions))
            .all(),
        )
      }
      const rank = new Map(slugs.map((s, i) => [s, i]))
      matched.sort((a, b) => (rank.get(a.slug) ?? 0) - (rank.get(b.slug) ?? 0))
      total = matched.length
      agentList = matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(toAgent)
    }
  } else if (kindEmpty) {
    agentList = []
    total = 0
  } else if (kindInMemory) {
    const matched = db
      .select()
      .from(agents)
      .where(whereClause)
      .orderBy(asc(agents.title))
      .all()
      .filter((row) => kindSlugs!.has(row.slug))
    total = matched.length
    agentList = matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(toAgent)
  } else {
    const rows = db
      .select()
      .from(agents)
      .where(whereClause)
      .orderBy(asc(agents.title))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)
      .all()

    const totalRows = db
      .select({ slug: agents.slug })
      .from(agents)
      .where(whereClause)
      .all()

    agentList = rows.map(toAgent)
    total = totalRows.length
  }

  // Distinct filter options from actual data
  const allCategories = db
    .selectDistinct({ category: agents.category })
    .from(agents)
    .all()
    .map(r => r.category)
    .filter((c): c is string => c !== null)

  let allLlms = db
    .selectDistinct({ llmName: agents.llmName })
    .from(agents)
    .all()
    .map(r => r.llmName)
    .filter(Boolean) as string[]
  // Non-agent kinds carry the 'n/a' placeholder model (D-037); it is not a real filter option.
  if (kindsOn) allLlms = allLlms.filter((l) => l !== 'n/a')

  const allMaturityStatuses = db
    .selectDistinct({ maturityStatus: agents.maturityStatus })
    .from(agents)
    .all()
    .map(r => r.maturityStatus)
    .filter(Boolean) as string[]

  if (kindsMod) {
    const info = kindsMod.loadKindInfo(db as never, agentList.map((a) => a.slug))
    const withKind = agentList.map((a) => {
      const kind = info.get(a.slug)?.kind ?? 'agent'
      // WR-09: a non-agent row never shows a "Try out" button, whatever its stored mode says.
      const mode = effectiveTryItOutMode(kind, a.tryItOutMode)
      return {
        ...a,
        ...(a.tryItOutMode === 'runnable' && mode !== 'runnable' ? { tryItOutMode: mode } : {}),
        kind,
        framework: info.get(a.slug)?.framework ?? null,
      }
    })
    return {
      ...catalogCompareData(url),
      agents: withKind,
      total,
      searchDegraded,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.ceil(total / PAGE_SIZE),
      categories: allCategories,
      llms: allLlms,
      maturityStatuses: allMaturityStatuses,
      kinds: kindsMod.listKinds(db as never),
      filters: { category, llm, maturity, q, kind },
    }
  }

  return {
    ...catalogCompareData(url),
    agents: agentList,
    total,
    searchDegraded,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.ceil(total / PAGE_SIZE),
    categories: allCategories,
    llms: allLlms,
    maturityStatuses: allMaturityStatuses,
    filters: { category, llm, maturity, q },
  }
}

// E6 (D-401): a database with no tables yet (fresh checkout before db:push/ingest) is an empty catalog, not a 500.
export const load: PageServerLoad = async (event) => {
  try {
    return await loadCatalog(event)
  } catch (err) {
    if (isMissingTableError(err)) return emptyCatalogData(event.url)
    throw err
  }
}
