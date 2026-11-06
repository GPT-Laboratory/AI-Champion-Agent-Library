// @vitest-environment jsdom
// Page-level accessibility: the real layout plus the real catalog / detail pages mounted into
// the layout's <main>, audited as a whole document (landmarks enabled).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { readable } from 'svelte/store'

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  replaceState: vi.fn(),
}))
vi.mock('$app/stores', () => ({
  page: readable({ url: new URL('http://localhost/catalog') }),
}))

import Layout from '../../routes/+layout.svelte'
import CatalogPage from '../../routes/catalog/+page.svelte'
import DetailPage from '../../routes/agents/[slug]/+page.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

const emptySnippet = createRawSnippet(() => ({ render: () => '<span></span>' }))

function mountLayout(user: { email: string } | null = { email: 'a@example.com' }) {
  document.body.innerHTML = ''
  const { container } = render(Layout, { props: { data: { user }, children: emptySnippet } as never })
  const main = container.querySelector('main') as HTMLElement
  return { container, main }
}

function agent(i: number, overrides: Record<string, unknown> = {}) {
  return {
    slug: `agent-${i}`,
    title: `Agent ${i}`,
    summary: 'Does things.',
    category: 'ops',
    maturityStatus: ['production', 'beta', 'experimental'][i % 3],
    tags: ['x', 'y'],
    tryItOutMode: ['runnable', 'external', 'none'][i % 3],
    tryItOutUrl: 'https://example.com/try',
    ...overrides,
  }
}

function catalogData(overrides: Record<string, unknown> = {}) {
  const agents = [0, 1, 2].map((i) => agent(i))
  return {
    agents,
    total: agents.length,
    searchDegraded: false,
    page: 1,
    pageSize: 24,
    totalPages: 2,
    categories: ['ops'],
    llms: ['gpt-4o'],
    maturityStatuses: ['beta'],
    filters: { category: null, llm: null, maturity: null, q: null },
    ...overrides,
  }
}

function headingLevelsOk(root: ParentNode): boolean {
  const levels = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => Number(h.tagName[1]))
  if (levels.length === 0) return true
  if (levels[0] !== 1) return false
  return levels.every((l, i) => i === 0 || l <= levels[i - 1] + 1)
}

function mountCatalog(data: Record<string, unknown>) {
  const { container, main } = mountLayout()
  render(CatalogPage, { target: main, props: { data } as never })
  return container
}

describe('layout structure', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('has the skip link as the first tabbable element, targeting the main landmark', () => {
    const { container, main } = mountLayout()
    const tabbables = container.querySelectorAll('a[href],button:not([disabled]),select,input,textarea,summary')
    const first = tabbables[0] as HTMLAnchorElement
    expect(first.textContent?.trim()).toBe('Skip to main content')
    expect(first.getAttribute('href')).toBe('#main-content')
    expect(document.getElementById('main-content')).toBe(main)
    expect(main.getAttribute('tabindex')).toBe('-1')
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(container.querySelector('nav[aria-label="Primary"]')).not.toBeNull()
  })
})

describe('catalog page composition', () => {
  it('results: single main and h1, ordered headings, skip target, no axe violations', async () => {
    const container = mountCatalog(catalogData())
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    expect(headingLevelsOk(container)).toBe(true)
    expect(container.querySelector('[role="search"]')).not.toBeNull()
    await expectNoAxeViolations(container, { landmarks: true })
  })

  it('empty: no-results message, live region present and says 0 agents found', async () => {
    const container = mountCatalog(
      catalogData({ agents: [], total: 0, totalPages: 0, filters: { category: null, llm: null, maturity: null, q: 'zzz' } }),
    )
    expect(container.textContent).toContain('No agents match "zzz"')
    expect(headingLevelsOk(container)).toBe(true)
    const region = container.querySelector('[aria-live="polite"]') as HTMLElement
    expect(region.textContent).toBe('0 agents found')
    await expectNoAxeViolations(container, { landmarks: true })
  })

  it('degraded: notice is visible and announced through the live region', async () => {
    const container = mountCatalog(catalogData({ searchDegraded: true }))
    expect(container.textContent).toContain('Search is temporarily limited')
    const region = container.querySelector('[aria-live="polite"]') as HTMLElement
    expect(region.textContent).toContain('Search is temporarily limited')
    await expectNoAxeViolations(container, { landmarks: true })
  })
})

describe('detail page composition', () => {
  const detail = (overrides: Record<string, unknown> = {}) => ({
    agent: {
      slug: 'example-agent',
      title: 'Example Agent',
      summary: 'An example agent.',
      systemPrompt: 'You are helpful.',
      llmName: 'gpt-4o',
      llmTemperature: 0.7,
      llmMaxTokens: 1000,
      llmTopP: null,
      toolNames: ['search'],
      requiresHumanApproval: false,
      category: 'ops',
      githubUrl: 'https://github.com/example/repo',
      linkLabel: null,
      maturityStatus: 'beta',
      tags: ['a'],
      specId: null,
      lastIngestedAt: '2026-08-18T00:00:00.000Z',
      tryItOutMode: 'none',
      tryItOutUrl: null,
      tryItOutTaskTemplate: null,
      customizableFields: null,
      fixedFields: [],
      fixedNote: null,
      ...overrides,
    },
    related: [
      { slug: 'other-agent', title: 'Other Agent', summary: 'Another one.', category: 'ops' },
      { slug: 'third-agent', title: 'Third Agent', summary: 'Yet another.', category: null },
    ],
    openTryOut: false,
  })

  function mountDetail(overrides: Record<string, unknown>) {
    const { container, main } = mountLayout()
    render(DetailPage, { target: main, props: { data: detail(overrides) } as never })
    return container
  }

  it('runnable: one h1, ordered headings, unique landmarks, no axe violations', async () => {
    const container = mountDetail({ tryItOutMode: 'runnable' })
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    expect(headingLevelsOk(container)).toBe(true)
    await expectNoAxeViolations(container, { landmarks: true })
  })

  it('runnable with the panel open: named asides and no axe violations', async () => {
    const { container, main } = mountLayout()
    render(DetailPage, {
      target: main,
      props: { data: { ...detail({ tryItOutMode: 'runnable' }), openTryOut: true } } as never,
    })
    expect(container.querySelector('#try-it-out-panel')).not.toBeNull()
    expect(headingLevelsOk(container)).toBe(true)
    await expectNoAxeViolations(container, { landmarks: true })
  })

  it('related agents section: h2 in order, links, no axe violations', async () => {
    const container = mountDetail({})
    expect(container.querySelector('#related-agents-heading')).not.toBeNull()
    expect(container.querySelectorAll('a[href="/agents/other-agent"]')).toHaveLength(1)
    expect(headingLevelsOk(container)).toBe(true)
    await expectNoAxeViolations(container, { landmarks: true })
  })

  it('external: new-tab links warn, and no axe violations', async () => {
    const container = mountDetail({ tryItOutMode: 'external', tryItOutUrl: 'https://example.com/try' })
    const external = Array.from(container.querySelectorAll('a[target="_blank"]'))
    expect(external.length).toBeGreaterThanOrEqual(2)
    for (const a of external) expect(a.textContent).toContain('(opens in new tab)')
    await expectNoAxeViolations(container, { landmarks: true })
  })
})
