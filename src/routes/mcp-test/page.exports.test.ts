// SvelteKit rejects any export from +page.server.ts other than load, actions and a few page options, answering
// 500 on every request to the page (found by running the dev server; unit tests that import `load` cannot see it).
import { describe, expect, it } from 'vitest'
import * as pageServer from './+page.server'
import { listCases, listPageSubjects } from '$lib/mcptest/pageData'

const VALID = new Set(['load', 'prerender', 'csr', 'ssr', 'trailingSlash', 'config', 'actions', 'entries'])

describe('/mcp-test +page.server.ts exports', () => {
  it('exports only names SvelteKit accepts', () => {
    for (const k of Object.keys(pageServer)) expect(VALID.has(k) || k.startsWith('_'), `invalid export ${k}`).toBe(true)
  })
  it('the page helpers live in $lib', () => {
    expect(listCases()).toHaveLength(12)
    expect(listPageSubjects().some((s) => s.id === 'fake:good')).toBe(true)
  })
})
