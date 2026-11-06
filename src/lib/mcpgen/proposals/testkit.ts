// Shared helpers for the proposal tests: fixtures parsed through the real registry, proposal documents,
// and the scenario op lists used by the golden, determinism and emitter tests. Invented Acme names only.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { buildPlan } from '../plan.js'
import { parseInput } from '../registry.js'
import type { GenerateOptions, ServerPlan, SourceModel } from '../types.js'
import { evaluateProposals, fingerprintOf, type Evaluation } from './index.js'

const FIXTURES = fileURLToPath(new URL('../testing/fixtures/', import.meta.url))
export const fixtureText = (name: string) => readFileSync(join(FIXTURES, name), 'utf8')

export interface Fixture {
  name: string
  model: SourceModel
  plan: ServerPlan
  fingerprint: string
  options: GenerateOptions
}

export function loadFixture(name: 'acme-openapi.yaml' | 'acme-schema.sql', options: GenerateOptions = {}): Fixture {
  const p = parseInput({ text: fixtureText(name), filename: name }, { options })
  if (!p.ok) throw new Error(`fixture ${name} did not parse`)
  const plan = buildPlan(p.model, options)
  return { name, model: p.model, plan, fingerprint: fingerprintOf(plan), options }
}

export type Op = Record<string, unknown>

export function doc(fx: Fixture, ops: Op[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, baseline: { fingerprint: fx.fingerprint }, ops, ...extra })
}

export function run(fx: Fixture, ops: Op[], lenient = false): Evaluation {
  return evaluateProposals({ model: fx.model, options: fx.options, text: doc(fx, ops), lenient })
}

export const op = (type: string, id: string, rest: Op): Op => ({ op: type, id, reason: 'test', ...rest })

export const codes = (ev: Evaluation): string[] => [...ev.fatal, ...ev.rejected].map((i) => i.code)

// ---- scenario op lists (http = acme-openapi.yaml, sql = acme-schema.sql) ----

export const SCENARIOS: Record<'http' | 'sql', Record<string, Op[]>> = {
  http: {
    'rename-describe': [
      op('rename_tool', 'rename-search', { tool: 'search_part', name: 'find_parts' }),
      op('describe_tool', 'describe-search', { tool: 'search_part', text: 'Finds parts by free text, one page at a time. Read-only.' }),
      op('rename_arg', 'rename-q', { tool: 'search_part', arg: 'q', name: 'text', keepAlias: true }),
      op('describe_arg', 'describe-text', { tool: 'search_part', arg: 'q', text: 'Words to look for in the part name.' }),
    ],
    hide: [op('hide_tool', 'hide-filter', { tool: 'filter_part_by_features' })],
    'defaults-pin': [
      op('set_paging_default', 'paging', { tool: 'search_part', arg: 'page_size', value: 10 }),
      op('pin_arg', 'pin-pages', { tool: 'filter_part_by_features', arg: 'max_pages', value: 3 }),
      op('set_projection', 'projection', { entity: 'part', fields: ['partId', 'name', 'category'] }),
    ],
    merge: [
      op('merge_tools', 'merge-lookup-search', {
        name: 'part_finder',
        description: 'One entry point for parts: look one up by code, or search by free text. Choose with the operation argument.',
        mode: 'dispatch',
        sources: [
          { tool: 'lookup_part_by_id', value: 'lookup' },
          { tool: 'search_part', value: 'search' },
        ],
      }),
    ],
    'merge-fanout': [
      op('merge_tools', 'merge-fan', {
        name: 'part_everywhere',
        description: 'Searches and filters parts in one call and labels each result by its source.',
        mode: 'fanout',
        sources: [
          { tool: 'search_part', value: 'search' },
          { tool: 'filter_part_by_features', value: 'filter' },
        ],
      }),
    ],
    split: [
      op('split_tool', 'split-search', {
        tool: 'search_part',
        tools: [
          { name: 'quick_part_search', description: 'A short preview page of the part search.', fixed: { page_size: 5 } },
          { name: 'wide_part_search', description: 'A wide page of the part search.', fixed: { page_size: 40 } },
        ],
      }),
    ],
    composite: [
      op('composite_tool', 'composite-details', {
        name: 'find_part_details',
        description: 'Searches parts by text, takes the first match and returns its full record. Says clearly when nothing matches.',
        args: [{ name: 'text', type: 'string', description: 'Words to look for.' }],
        steps: [
          { id: 'find', tool: 'search_part', args: { q: { from: 'input.text' }, page_size: { const: 3 } }, select: ['partId'] },
          { id: 'detail', tool: 'lookup_part_by_id', args: { partId: { from: 'find.results[0].partId' } } },
        ],
      }),
    ],
    'composite-fanout': [
      op('composite_tool', 'composite-many', {
        name: 'find_part_records',
        description: 'Searches parts by text and returns the full record of each of the first matches.',
        args: [{ name: 'text', type: 'string' }],
        steps: [
          { id: 'find', tool: 'search_part', args: { q: { from: 'input.text' }, page_size: { const: 5 } }, select: ['partId'] },
          { id: 'each', tool: 'lookup_part_by_id', args: { partId: { from: 'item.partId' } }, forEach: { from: 'find.results', max: 5 } },
        ],
        output: { first: 'each.results[0].result', total: 'each.count' },
      }),
    ],
  },
  sql: {
    'rename-describe': [
      op('rename_tool', 'rename-customer', { tool: 'query_customer', name: 'find_customer' }),
      op('describe_tool', 'describe-customer', { tool: 'query_customer', text: 'Finds customers by one field. Read-only; at most 100 rows per call.' }),
      op('rename_arg', 'rename-limit', { tool: 'query_customer', arg: 'limit', name: 'row_limit', keepAlias: true }),
    ],
    hide: [op('hide_tool', 'hide-notes', { tool: 'query_note_log' })],
    'defaults-pin': [
      op('set_arg_default', 'default-match', { tool: 'query_order', arg: 'match', value: 'contains' }),
      op('pin_arg', 'pin-match', { tool: 'query_order_line', arg: 'match', value: 'equals' }),
      op('set_paging_default', 'paging', { tool: 'query_customer', arg: 'limit', value: 10 }),
    ],
    merge: [
      op('merge_tools', 'merge-orders', {
        name: 'order_data',
        description: 'Orders and their lines from one tool; choose which with the operation argument.',
        mode: 'dispatch',
        sources: [
          { tool: 'query_order', value: 'orders' },
          { tool: 'query_order_line', value: 'lines' },
        ],
      }),
    ],
    split: [
      op('split_tool', 'split-customer', {
        tool: 'query_customer',
        tools: [
          { name: 'customers_starting_with', description: 'Customers whose value starts with the text.', fixed: { match: 'startsWith' } },
          { name: 'customers_exact', description: 'Customers whose value equals the text.', fixed: { match: 'equals' } },
        ],
      }),
    ],
    composite: [
      op('composite_tool', 'composite-orders', {
        name: 'orders_of_customer',
        description: 'Finds the first customer whose name contains the text and returns their orders. Says clearly when nothing matches.',
        args: [{ name: 'name', type: 'string', description: 'Text the customer name must contain.' }],
        steps: [
          { id: 'who', tool: 'query_customer', args: { field: { const: 'customer_name' }, value: { from: 'input.name' }, match: { const: 'contains' }, limit: { const: 1 } }, select: ['customer_id'] },
          { id: 'orders', tool: 'query_order', args: { field: { const: 'customer_id' }, value: { from: 'who.results[0].customer_id' }, match: { const: 'equals' }, limit: { const: 10 } } },
        ],
      }),
    ],
  },
}
