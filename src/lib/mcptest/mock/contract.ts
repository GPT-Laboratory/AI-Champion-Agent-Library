// Single source for routes, dataset names, fake tool names and hint regexes (Phase 15).
// Shared by the mock upstream, the fake runtime (15-04) and the scorer wiring (15-07).
// Imports nothing from $lib, svelte or @sveltejs.

export const ENV_VARS = { baseUrl: 'ACME_BASE_URL', apiKey: 'ACME_API_KEY', baseUrlB: 'ACME_BASE_URL_B' } as const

export const ROUTES = {
  items: '/items', // GET ?q&category&supplier&page&per_page -> {items,page,per_page,total}
  itemById: '/items/:id', // GET -> item | 404 {message:'Item not found'}
  itemByCode: '/items/by-code/:code', // GET alt key
  categoryItems: '/categories/:c/items', // GET ?limit&cursor (bulk dataset, 5000 items) -> {items,next}
  products: '/products/by-gtin/:code', // GET (codes dataset; hit counter proves pre-validation)
  vocab: '/vocabularies/:name', // GET controlled vocabulary
  widgets: '/widgets',
  widgetById: '/widgets/:id', // docs dataset (documented set)
  components: '/components/:id', // composite backend A
  assemblies: '/assemblies/:id', // composite backend B
  health: '/health',
} as const

export const DATASETS = ['catalog', 'bulk', 'codes', 'docs', 'components', 'products'] as const
export type DatasetName = (typeof DATASETS)[number]

export const TOOL_NAMES = {
  lookupItem: 'lookup_item',
  searchItems: 'search_items',
  listBySupplier: 'list_items_by_supplier',
  findByAttribute: 'find_items_by_attribute',
  listCategoryItems: 'list_category_items',
  lookupByGtin: 'lookup_product_by_gtin',
  listWidgets: 'list_widgets',
  getWidget: 'get_widget',
  assemble: 'assemble_composite',
} as const

/** Regex SOURCE strings (case-insensitive when compiled) per behaviour or special kind. Each matches exactly one TOOL_NAMES value. */
export const HINTS: Record<string, string> = {
  lookup_by_id: '^lookup_item$|item.*(get|lookup)',
  lookup_by_alt_key: '^lookup_item$',
  partition_filter: 'supplier',
  derived_filter: 'attribute',
  projection: '^search_items$',
  pagesize_clamp: '^search_items$',
  pagination_ceiling: '^search_items$',
  bad_input: '^lookup_item$',
  empty_vs_error: '^search_items$',
  auth_fail: '^search_items$',
  grounding: '^list_widgets$',
  profile: '^get_widget$',
  composite: 'assemble',
  large_response: 'category',
  fault_retry: '^search_items$',
  fault_timeout: '^search_items$',
  fault_malformed: '^search_items$',
  secret_canary: '^search_items$',
  i18n_codes: 'gtin',
  rerun_variance: '^search_items$',
}

/** Raw items carry at least this many top-level fields; a projecting server caps output at 12. */
export const ITEM_FIELD_COUNT_MIN = 20
