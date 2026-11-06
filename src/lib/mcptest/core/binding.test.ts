import { describe, it, expect } from 'vitest'
import { bindTool } from './binding'

const tools = [
  { name: 'get_item', description: 'Fetch one record' },
  { name: 'search_items', description: 'Search the catalogue' },
  { name: 'list_partners', description: 'Lists entries by partner' }
]

describe('bindTool', () => {
  it('explicit tool wins', () => {
    expect(bindTool({ tool: 'get_item', tool_hint: 'search' }, tools)).toMatchObject({ tool: 'get_item', boundBy: 'explicit', status: 'ok' })
  })
  it('explicit tool missing -> no_tool', () => {
    expect(bindTool({ tool: 'nope' }, tools)).toMatchObject({ status: 'no_tool', boundBy: 'none' })
  })
  it('single name match -> hint', () => {
    expect(bindTool({ tool_hint: 'get' }, tools)).toMatchObject({ tool: 'get_item', boundBy: 'hint', status: 'ok' })
  })
  it('case-insensitive', () => {
    expect(bindTool({ tool_hint: 'SEARCH' }, tools).tool).toBe('search_items')
  })
  it('falls back to description when no name matches', () => {
    expect(bindTool({ tool_hint: 'catalogue' }, tools).tool).toBe('search_items')
  })
  it('two matches -> ambiguous', () => {
    const r = bindTool({ tool_hint: 'item' }, tools)
    expect(r.status).toBe('ambiguous')
    expect(r.matches).toEqual(['get_item', 'search_items'])
  })
  it('none -> no_tool', () => {
    expect(bindTool({ tool_hint: 'zzz' }, tools).status).toBe('no_tool')
  })
  it('override wins and is explicit', () => {
    expect(bindTool({ tool_hint: 'get' }, tools, { tool: 'list_partners' })).toMatchObject({ tool: 'list_partners', boundBy: 'explicit' })
  })
  it('invalid regex does not crash', () => {
    expect(bindTool({ tool_hint: '(' }, tools).status).toBe('ambiguous')
  })
})
