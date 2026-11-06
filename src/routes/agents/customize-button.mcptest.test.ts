// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import { tick } from 'svelte'

vi.mock('$lib/server/db', () => ({ db: { select: vi.fn() }, agents: { slug: 'slug' } }))
vi.mock('$lib/server/search/index.js', () => ({ related: vi.fn(async () => []) }))
vi.mock('$lib/server/tryitout/service', () => ({ warmForSession: vi.fn(() => Promise.resolve()) }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), inArray: vi.fn() }))
vi.mock('@sveltejs/kit', () => ({ error: vi.fn() }))

import Page from './[slug]/+page.svelte'
import { mcpTesterData } from '$lib/pageFlags'

const baseAgent = {
  slug: 'example-agent',
  title: 'Example Agent',
  summary: 'An example agent used for testing.',
  systemPrompt: 'You are a helpful assistant.',
  llmName: 'gpt-4o',
  llmTemperature: 0.7,
  llmMaxTokens: null,
  llmTopP: null,
  toolNames: [] as string[],
  requiresHumanApproval: false,
  category: null,
  githubUrl: null as string | null,
  maturityStatus: 'experimental',
  tags: [] as string[],
  specId: null,
  lastIngestedAt: '2026-08-18T00:00:00.000Z',
  tryItOutMode: 'none',
  tryItOutUrl: null as string | null,
  tryItOutTaskTemplate: null,
  customizableFields: [] as string[] | null,
  fixedFields: [] as string[],
  fixedNote: null,
}

async function renderPage(extra: Record<string, unknown>, open = true) {
  const view = render(Page, { props: { data: { agent: baseAgent, openTryOut: false, ...extra } as never } })
  if (open) {
    await fireEvent.click(screen.getByRole('button', { name: /customize/i }))
    await tick()
    await tick()
  }
  return view
}

describe('detail page Test MCP servers gating', () => {
  it('flag off (key absent): three placeholders, no tester entry', async () => {
    await renderPage({})
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
    expect(document.body.textContent).not.toContain('Test MCP servers')
  })

  it('mcpTesterEnabled false is treated as off and the DOM equals the DOM without the key', async () => {
    const norm = (h: string) => h.replace(/\b(customize-menu|gen-mcp)-[\w-]*c\d+/g, '$1-ID').replace(/c\d+/g, 'cN')
    const a = await renderPage({}, false)
    const htmlA = norm(a.container.innerHTML)
    a.unmount()
    const b = await renderPage({ mcpTesterEnabled: false }, false)
    expect(norm(b.container.innerHTML)).toBe(htmlA)
  })

  it('flag on: a link to /mcp-test is the last menu item', async () => {
    await renderPage({ mcpTesterEnabled: true })
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(4)
    expect(items[3].getAttribute('href')).toBe('/mcp-test')
  })
})

describe('mcpTesterData load helper', () => {
  it('returns no key when the flag is off', () => {
    const off = mcpTesterData({})
    expect(off).toEqual({})
    expect(Object.prototype.hasOwnProperty.call(off, 'mcpTesterEnabled')).toBe(false)
    expect('mcpTesterEnabled' in mcpTesterData({ MCP_TESTER: '0' })).toBe(false)
  })
  it('returns mcpTesterEnabled true when the flag is on', () => {
    expect(mcpTesterData({ MCP_TESTER: '1' })).toEqual({ mcpTesterEnabled: true })
  })
})
