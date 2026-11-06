import { z } from 'zod'
import { LOCAL_MCP_ALLOWED_TOOLS } from './types'

// Argument names mirror the LVI-INFO server's tool signatures. Clamped so one call stays small.
const str = z
  .string()
  // eslint-disable-next-line no-control-regex
  .refine((s) => s.length > 0 && s.length <= 64 && !/[\u0000-\u001F\u007F]/.test(s))

const SCHEMAS = {
  lookup_by_lvi_number: z.object({ lvi_number: str }).strict(),
  get_product_by_link: z.object({ product_link_number: str }).strict(),
  get_product_by_gtin: z.object({ gtin: str }).strict(),
  search_products: z
    .object({
      supplier_number: str.optional(),
      lvi_number: str.optional(),
      business_id: str.optional(),
      product_type: str.optional(),
      is_active: z.boolean().optional(),
      page: z.number().int().min(0).max(1000).optional(),
      page_size: z.number().int().min(1).optional(),
    })
    .strict(),
  filter_by_etim_class: z
    .object({
      etim_class_id: str,
      etim_feature_id: str.optional(),
      supplier_number: str.optional(),
      lvi_number: str.optional(),
      business_id: str.optional(),
      max_pages: z.number().int().min(1).optional(),
    })
    .strict(),
} as const

export type ValidateResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; status: 403 | 400; error: string }

/** 403 for a tool outside the allow-list, 400 for invalid arguments. Error text is fixed; values are never echoed. */
export function validateToolCall(name: string, args: unknown): ValidateResult {
  if (!(LOCAL_MCP_ALLOWED_TOOLS as readonly string[]).includes(name)) {
    return { ok: false, status: 403, error: 'tool not allowed' }
  }
  const parsed = SCHEMAS[name as keyof typeof SCHEMAS].safeParse(args)
  if (!parsed.success) return { ok: false, status: 400, error: 'invalid arguments' }
  const out: Record<string, unknown> = { ...parsed.data }
  if (name === 'search_products') {
    out.page_size = Math.min((out.page_size as number | undefined) ?? 10, 25)
  } else if (name === 'filter_by_etim_class') {
    if (out.supplier_number === undefined && out.business_id === undefined && out.lvi_number === undefined) {
      return { ok: false, status: 400, error: 'filter_by_etim_class needs supplier_number, business_id or lvi_number' }
    }
    out.max_pages = Math.min((out.max_pages as number | undefined) ?? 2, 2)
  }
  return { ok: true, args: out }
}
