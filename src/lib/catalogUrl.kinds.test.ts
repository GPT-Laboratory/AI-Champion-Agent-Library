import { describe, it, expect } from 'vitest'
import { buildCatalogParams, parseKind } from './catalogUrl'

describe('buildCatalogParams kind', () => {
  it('omits kind when absent or empty (output unchanged)', () => {
    expect(buildCatalogParams({ category: 'x' }).toString()).toBe('category=x&page=1')
    expect(buildCatalogParams({ kind: '' }).toString()).toBe('page=1')
  })
  it('sets kind when non-empty', () => {
    expect(buildCatalogParams({ kind: 'system', q: 'a' }).get('kind')).toBe('system')
  })
})

describe('parseKind', () => {
  it('accepts allowed values only', () => {
    expect(parseKind('system')).toBe('system')
    expect(parseKind('mcp-server')).toBe('mcp-server')
    expect(parseKind('System')).toBeNull()
    expect(parseKind("x' OR 1=1")).toBeNull()
    expect(parseKind('')).toBeNull()
    expect(parseKind(null)).toBeNull()
    expect(parseKind(undefined)).toBeNull()
  })
})
