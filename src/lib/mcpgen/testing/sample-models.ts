// Hand-built synthetic SourceModels ("Acme") used by golden tests and later plans.
// All names and values are invented. No adapter is involved, so the core is tested independently.
import type { Field, SourceModel } from '../types.js'

function extraFields(n: number): Field[] {
  const out: Field[] = []
  for (let i = 1; i <= n; i++) {
    out.push({ name: `attr_${String(i).padStart(2, '0')}`, type: i % 3 === 0 ? 'number' : 'string' })
  }
  return out
}

/** HTTP backend: one wide entity, a nested key/value array no request parameter can filter. */
export const acmeHttp: SourceModel = {
  name: 'Acme Catalog',
  backend: { kind: 'http', baseUrlEnv: 'ACME_BASE_URL' },
  auth: { scheme: 'apiKeyHeader', paramName: 'X-Api-Key', envVar: 'ACME_API_KEY' },
  entities: [
    {
      id: 'product',
      label: 'Product',
      fields: [
        { name: 'product_id', type: 'string', identifier: true, description: 'Stable product code' },
        { name: 'name', type: 'string', nameLike: true, description: 'Display name' },
        { name: 'category', type: 'string', classLike: true, description: 'Product group' },
        { name: 'price', type: 'number' },
        { name: 'in_stock', type: 'boolean' },
        { name: 'features', type: 'array', description: 'Technical features as key/value entries' },
        ...extraFields(28),
      ],
      identifierFields: ['product_id'],
      nested: [
        {
          field: 'features',
          itemFields: [
            { name: 'feature_code', type: 'string', classLike: true },
            { name: 'feature_value', type: 'string' },
            { name: 'unit', type: 'string' },
          ],
          keyFields: ['feature_code'],
          valueFields: ['feature_value', 'unit'],
        },
      ],
    },
  ],
  operations: [
    {
      id: 'listProducts',
      kind: 'list',
      method: 'GET',
      path: '/products',
      entity: 'product',
      params: [
        { name: 'page', in: 'query', type: 'integer', required: false, min: 1 },
        { name: 'size', in: 'query', type: 'integer', required: false, min: 1, max: 50 },
        { name: 'category', in: 'query', type: 'string', required: false, description: 'Filter by product group' },
      ],
      pageParam: 'page',
      pageSizeParam: 'size',
      summary: 'List products one page at a time',
    },
    {
      id: 'getProduct',
      kind: 'get',
      method: 'GET',
      path: '/products/{product_id}',
      entity: 'product',
      params: [{ name: 'product_id', in: 'path', type: 'string', required: true, description: 'Product code' }],
      summary: 'Fetch one product by code',
    },
    {
      id: 'searchProducts',
      kind: 'search',
      method: 'GET',
      path: '/products/search',
      entity: 'product',
      params: [
        { name: 'q', in: 'query', type: 'string', required: true, description: 'Free text query' },
        { name: 'page', in: 'query', type: 'integer', required: false, min: 1 },
        { name: 'size', in: 'query', type: 'integer', required: false, min: 1, max: 50 },
      ],
      pageParam: 'page',
      pageSizeParam: 'size',
      summary: 'Search products by free text. See https://docs.acme.example/search for details',
    },
  ],
  limits: { maxPageSize: 50, resultCeiling: 10000, maxResponseItems: 200 },
  gaps: [],
  writeOperationsDropped: ['createProduct'],
}

/** Dataset backend: one flat table with a label dictionary. */
export const acmeDataset: SourceModel = {
  name: 'Acme Inventory',
  backend: { kind: 'dataset', datasetPathEnv: 'ACME_DATA_FILE' },
  auth: { scheme: 'none' },
  entities: [
    {
      id: 'item',
      label: 'Inventory item',
      fields: [
        { name: 'item_code', type: 'string', identifier: true, label: 'Item code' },
        { name: 'item_name', type: 'string', nameLike: true, label: 'Item name' },
        { name: 'group', type: 'string', classLike: true, label: 'Item group' },
        { name: 'quantity', type: 'integer', label: 'Quantity on hand' },
        { name: 'unit_price', type: 'number', label: 'Unit price' },
        { name: 'location', type: 'string', label: 'Warehouse location' },
      ],
      identifierFields: ['item_code'],
      nested: [],
    },
  ],
  operations: [],
  limits: { maxPageSize: 50, maxResponseItems: 200 },
  gaps: [],
  writeOperationsDropped: [],
}

/** SQL backend: two tables with a foreign key (customer_id). */
export const acmeSql: SourceModel = {
  name: 'Acme Orders',
  backend: { kind: 'sql', dsnEnv: 'ACME_DSN' },
  auth: { scheme: 'none' },
  entities: [
    {
      id: 'customer',
      label: 'Customer',
      fields: [
        { name: 'customer_id', type: 'integer', identifier: true },
        { name: 'customer_name', type: 'string', nameLike: true },
        { name: 'segment', type: 'string', classLike: true },
        { name: 'city', type: 'string' },
      ],
      identifierFields: ['customer_id'],
      nested: [],
    },
    {
      id: 'order',
      label: 'Order',
      fields: [
        { name: 'order_id', type: 'integer', identifier: true },
        { name: 'customer_id', type: 'integer', description: 'References customer.customer_id' },
        { name: 'order_status', type: 'string', classLike: true },
        { name: 'total', type: 'number' },
        { name: 'placed_on', type: 'string' },
      ],
      identifierFields: ['order_id'],
      nested: [],
    },
  ],
  operations: [],
  limits: { maxPageSize: 25, resultCeiling: 1000, maxResponseItems: 100 },
  gaps: [],
  writeOperationsDropped: [],
}
