// Review fix WR-02: with MCP_TESTER off every method on every tester route answers 404, not SvelteKit's 405.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as runs from './runs/+server'
import * as status from './runs/[id]/+server'
import * as report from './runs/[id]/report/+server'
import * as page from '../../mcp-test/+page.server'

const routes: [string, { fallback?: unknown } & Record<string, unknown>, string][] = [
  ['/api/mcp-test/runs', runs, 'POST'],
  ['/api/mcp-test/runs/:id', status, 'GET'],
  ['/api/mcp-test/runs/:id/report', report, 'GET']
]
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

let prev: string | undefined
beforeEach(() => {
  prev = process.env.MCP_TESTER
})
afterEach(() => {
  if (prev === undefined) delete process.env.MCP_TESTER
  else process.env.MCP_TESTER = prev
})

describe('fallback exports', () => {
  for (const [path, mod, allowed] of routes) {
    it(`${path} exports a fallback and handles only ${allowed}`, () => {
      expect(typeof mod.fallback).toBe('function')
      for (const m of METHODS.filter((x) => x !== allowed)) expect(mod[m], `${path} must not export ${m}`).toBeUndefined()
    })

    it(`${path} fallback answers 404 for every method with the flag off`, async () => {
      delete process.env.MCP_TESTER
      for (const method of METHODS) {
        const call = () => (mod.fallback as (e: unknown) => Response)({ request: new Request('http://x' + path, { method: method === 'GET' ? 'GET' : method }) })
        expect(call, method).toThrowError(expect.objectContaining({ status: 404 }))
      }
    })

    it(`${path} fallback answers 405 with an Allow header with the flag on`, () => {
      process.env.MCP_TESTER = '1'
      const res = (mod.fallback as (e: unknown) => Response)({ request: new Request('http://x' + path, { method: 'PUT' }) })
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe(allowed)
    })
  }
})

describe('/mcp-test page action', () => {
  it('a POST to the page is 404 with the flag off and 405 with it on', async () => {
    const act = page.actions.default as (e: unknown) => unknown
    delete process.env.MCP_TESTER
    expect(() => act({})).toThrowError(expect.objectContaining({ status: 404 }))
    process.env.MCP_TESTER = '1'
    expect(() => act({})).toThrowError(expect.objectContaining({ status: 405 }))
  })
})
