import { describe, it, expect } from 'vitest'
import { validateToolCall } from './allowlist'

describe('validateToolCall', () => {
  it('accepts the documented arguments of each tool', () => {
    expect(validateToolCall('lookup_by_lvi_number', { lvi_number: '123' })).toEqual({ ok: true, args: { lvi_number: '123' } })
    expect(validateToolCall('get_product_by_link', { product_link_number: 'L1' }).ok).toBe(true)
    expect(validateToolCall('get_product_by_gtin', { gtin: '6400000000000' }).ok).toBe(true)
    expect(
      validateToolCall('search_products', {
        supplier_number: 's', lvi_number: 'l', business_id: 'b', product_type: 't', is_active: true, page: 1, page_size: 5,
      }).ok,
    ).toBe(true)
    expect(
      validateToolCall('filter_by_etim_class', { etim_class_id: 'EC1', etim_feature_id: 'EF1', supplier_number: 's', max_pages: 1 }).ok,
    ).toBe(true)
  })

  it('rejects tools outside the allow-list with 403', () => {
    for (const n of ['list_suppliers', 'get_changed_products', 'nope', '__proto__', '']) {
      expect(validateToolCall(n, {})).toMatchObject({ ok: false, status: 403 })
    }
  })

  it('rejects unknown keys, wrong types, long strings, control chars, bad pages with 400', () => {
    const bad: Array<[string, unknown]> = [
      ['lookup_by_lvi_number', { lvi_number: '1', extra: 1 }],
      ['lookup_by_lvi_number', { lvi_number: 5 }],
      ['lookup_by_lvi_number', {}],
      ['lookup_by_lvi_number', { lvi_number: 'x'.repeat(65) }],
      ['lookup_by_lvi_number', { lvi_number: 'a\u0000b' }],
      ['lookup_by_lvi_number', 'str'],
      ['lookup_by_lvi_number', null],
      ['search_products', { page: -1 }],
      ['search_products', { page: 1.5 }],
      ['search_products', { is_active: 'yes' }],
      ['filter_by_etim_class', { supplier_number: 's' }],
    ]
    for (const [n, a] of bad) expect(validateToolCall(n, a)).toMatchObject({ ok: false, status: 400 })
  })

  it('never echoes argument values in the error', () => {
    const r = validateToolCall('lookup_by_lvi_number', { lvi_number: 'SECRET-VALUE-' + 'x'.repeat(70) })
    expect(JSON.stringify(r)).not.toContain('SECRET-VALUE')
  })

  it('clamps page_size and max_pages', () => {
    expect(validateToolCall('search_products', {})).toEqual({ ok: true, args: { page_size: 10 } })
    expect(validateToolCall('search_products', { page_size: 900 })).toEqual({ ok: true, args: { page_size: 25 } })
    expect(validateToolCall('search_products', { page_size: 3 })).toEqual({ ok: true, args: { page_size: 3 } })
    expect(validateToolCall('filter_by_etim_class', { etim_class_id: 'E', supplier_number: 's' })).toMatchObject({
      ok: true, args: { max_pages: 2 },
    })
    expect(validateToolCall('filter_by_etim_class', { etim_class_id: 'E', lvi_number: '1', max_pages: 15 })).toMatchObject({
      ok: true, args: { max_pages: 2 },
    })
  })

  it('requires a narrowing filter for filter_by_etim_class', () => {
    const r = validateToolCall('filter_by_etim_class', { etim_class_id: 'E' })
    expect(r).toMatchObject({ ok: false, status: 400 })
    expect((r as { error: string }).error).toMatch(/supplier_number|business_id|lvi_number/)
  })
})
