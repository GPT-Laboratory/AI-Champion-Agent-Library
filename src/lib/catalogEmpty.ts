import { agentKindsEnabled } from './flags.js'
import { catalogCompareData } from './compare.js'

/** E6 (D-401): the catalog load result for an empty or not-yet-created database. Same shape as the real one. */
export function emptyCatalogData(url: URL) {
  const base = {
    ...catalogCompareData(url),
    agents: [] as never[],
    total: 0,
    searchDegraded: false,
    page: 1,
    pageSize: 24,
    totalPages: 0,
    categories: [] as string[],
    llms: [] as string[],
    maturityStatuses: [] as string[],
  }
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200) || null
  const filters = {
    category: url.searchParams.get('category') ?? null,
    llm: url.searchParams.get('llm') ?? null,
    maturity: url.searchParams.get('maturity') ?? null,
    q,
  }
  if (agentKindsEnabled()) return { ...base, kinds: [] as string[], filters: { ...filters, kind: null } }
  return { ...base, filters }
}
