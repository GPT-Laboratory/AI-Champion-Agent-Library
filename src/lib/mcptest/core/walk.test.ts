import { describe, it, expect } from 'vitest'
import {
  iterDicts,
  findDictWithField,
  findProductByValue,
  findAllProducts,
  productBelongsToPartition,
  payload,
  textBlob
} from './walk'

const data = {
  results: [
    { sku: 'A-1', name: 'Widget', vendor_name: 'Acme Corp' },
    { id: 'B-2', info: { maker: 'Example Ltd' } }
  ]
}

describe('walkers', () => {
  it('iterDicts is depth-first', () => {
    const keys = [...iterDicts(data)].map((d) => Object.keys(d)[0])
    expect(keys).toEqual(['results', 'sku', 'id', 'maker'])
  })
  it('findDictWithField finds nested', () => {
    expect(findDictWithField(data, ['maker'])).toEqual({ maker: 'Example Ltd' })
    expect(findDictWithField(data, ['nope'])).toBeUndefined()
  })
  it('findProductByValue matches any alias key', () => {
    expect(findProductByValue(data, ['id', 'sku'], 'A-1')?.name).toBe('Widget')
    expect(findProductByValue(data, ['id', 'sku'], 'B-2')).toBeDefined()
    expect(findProductByValue(data, ['id', 'sku'], 'Z')).toBeUndefined()
  })
  it('findAllProducts returns item-like objects', () => {
    expect(findAllProducts(data)).toHaveLength(2)
  })
  it('partition rules: key endswith, nested key, text contains', () => {
    const [a, b] = findAllProducts(data)
    expect(productBelongsToPartition(a, ['name'], 'acme corp')).toBe(true)
    expect(productBelongsToPartition(b, ['maker'], 'Example Ltd')).toBe(true)
    expect(productBelongsToPartition({ note: 'sold by Example Ltd today' }, ['supplier'], 'Example Ltd')).toBe(true)
    expect(productBelongsToPartition(a, ['name'], 'Other')).toBe(false)
  })
  it('tolerates non-object payloads', () => {
    for (const p of [null, undefined, 'text', 5]) {
      expect([...iterDicts(p)]).toEqual([])
      expect(findAllProducts(p)).toEqual([])
      expect(findProductByValue(p, ['id'], 'x')).toBeUndefined()
      expect(productBelongsToPartition(p, ['a'], 'x')).toBe(false)
    }
  })
  it('payload and textBlob', () => {
    const r = { kind: 'result' as const, isError: false, text: '{"a":1}', content: [] }
    expect(payload(r)).toEqual({ a: 1 })
    expect(payload({ ...r, structured: { b: 2 } })).toEqual({ b: 2 })
    expect(payload({ ...r, text: 'plain' })).toBe('plain')
    expect(textBlob({ ...r, structured: { b: 2 } })).toContain('"b":2')
  })
})
