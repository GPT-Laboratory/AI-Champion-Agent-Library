// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expectNoAxeViolations } from '$lib/testing/axe'
import { baseAgent } from './specviewer.fixture'

const mockGet = vi.fn()
vi.mock('$lib/server/db', () => {
  const where = vi.fn(() => ({ get: mockGet, all: () => [] }))
  return { db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })) }, agents: { slug: 'slug' } }
})
vi.mock('$lib/server/search/index.js', () => ({ related: vi.fn(async () => []) }))
vi.mock('$lib/server/tryitout/service', () => ({ warmForSession: vi.fn(() => Promise.resolve()) }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), inArray: vi.fn() }))
vi.mock('@sveltejs/kit', () => ({ error: vi.fn() }))

import Page from './[slug]/+page.svelte'

const dbRow = {
  slug: 'x',
  title: 'X',
  summary: '',
  systemPrompt: 'key sk-abcdefghijklmnopqrstuvwxyz0123 <b>bold</b>',
  llmName: 'gpt-4o',
  llmTemperature: 0.7,
  llmMaxTokens: null,
  llmTopP: null,
  toolNames: '[]',
  inputSchema: '[]',
  requiresHumanApproval: false,
  category: null,
  githubUrl: null,
  maturityStatus: 'beta',
  tags: '[]',
  specId: null,
  lastIngestedAt: '2026-01-01',
  tryItOutMode: 'none',
}

let saved: string | undefined
beforeEach(() => {
  saved = process.env.UI_SPEC_VIEWER
  mockGet.mockReturnValue(dbRow)
})
afterEach(() => {
  if (saved === undefined) delete process.env.UI_SPEC_VIEWER
  else process.env.UI_SPEC_VIEWER = saved
})

describe('UI_SPEC_VIEWER flag off', () => {
  it('detail page DOM is byte-identical to the pre-flag baseline', () => {
    delete process.env.UI_SPEC_VIEWER
    const { container } = render(Page, { props: { data: { agent: baseAgent, openTryOut: false, related: [] } as never } })
    const baseline = readFileSync(resolve(process.cwd(), 'src/routes/agents/__fixtures__/detail-flag-off.html'), 'utf8')
    // Svelte emits one empty `<!---->` anchor (plus a whitespace text node) for any `{#if}`;
    // it is inert, so compare with anchors and whitespace normalised. Everything else is exact.
    const norm = (h: string) => h.replace(/<!---->/g, '').replace(/\s+/g, ' ')
    expect(norm(container.innerHTML)).toBe(norm(baseline))
    expect(screen.queryByText('Raw spec')).toBeNull()
  })

  it('loader keys are exactly the pre-flag set', async () => {
    delete process.env.UI_SPEC_VIEWER
    const { load } = await import('./[slug]/+page.server.js')
    const out = (await (load as never as (a: unknown) => Promise<object>)({ params: { slug: 'x' }, url: new URL('http://l/') })) as Record<string, unknown>
    expect(Object.keys(out)).toEqual(['agent', 'related', 'openTryOut'])
  })
})

describe('UI_SPEC_VIEWER flag on', () => {
  it('loader adds a redacted specViewer key', async () => {
    process.env.UI_SPEC_VIEWER = '1'
    const { load } = await import('./[slug]/+page.server.js')
    const out = (await (load as never as (a: unknown) => Promise<{ specViewer: { text: string } }>)({
      params: { slug: 'x' },
      url: new URL('http://l/'),
    }))
    expect(out.specViewer.text).toContain('slug: x')
    expect(out.specViewer.text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123')
  })

  async function renderOn() {
    const text = 'slug: x\nsystemPrompt: <img src=x onerror=alert(1)>\ntags:\n  - a\n'
    const view = render(Page, {
      props: { data: { agent: baseAgent, openTryOut: false, related: [], specViewer: { text, truncated: false } } as never },
    })
    return view
  }

  it('is collapsed, keyboard operable, and renders text as escaped spans', async () => {
    const { container } = await renderOn()
    const btn = screen.getByRole('button', { name: /raw spec/i })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('#spec-viewer-region pre')).toBeNull()
    btn.focus()
    await fireEvent.click(btn)
    await tick()
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    const pre = container.querySelector('#spec-viewer-region pre')!
    expect(pre.getAttribute('tabindex')).toBe('0')
    expect(pre.querySelector('img')).toBeNull()
    expect(pre.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(pre.querySelectorAll('span').length).toBeGreaterThan(0)
  })

  it('has no axe violations collapsed or expanded', async () => {
    const { container } = await renderOn()
    await expectNoAxeViolations(container)
    await fireEvent.click(screen.getByRole('button', { name: /raw spec/i }))
    await tick()
    await expectNoAxeViolations(container)
  })
})
