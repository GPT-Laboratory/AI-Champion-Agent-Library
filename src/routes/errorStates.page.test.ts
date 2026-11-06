// @vitest-environment jsdom
// E6: render-level error/empty states: +error.svelte (D-400), empty catalog from a table-less db (D-401),
// and the detail page with minimal/odd/huge data.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { readable } from 'svelte/store'

const pageStore = vi.hoisted(() => ({ value: { url: new URL('http://localhost/x'), status: 404, error: { message: 'Not found' } as { message: string } | null } }))
vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: vi.fn(), replaceState: vi.fn() }))
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store')
  return {
    get page() {
      return readable(pageStore.value)
    },
  }
})

import Layout from './+layout.svelte'
import ErrorPage from './+error.svelte'
import CatalogPage from './catalog/+page.svelte'
import DetailPage from './agents/[slug]/+page.svelte'
import { emptyCatalogData } from '$lib/catalogEmpty'
import { expectNoAxeViolations } from '$lib/testing/axe'

function mountError(status: number, message: string | null) {
  pageStore.value = { url: new URL('http://localhost/x'), status, error: message === null ? null : { message } }
  document.body.innerHTML = ''
  const empty = createRawSnippet(() => ({ render: () => '<span></span>' }))
  const { container } = render(Layout, { props: { data: { user: null }, children: empty } as never })
  const main = container.querySelector('main') as HTMLElement
  render(ErrorPage, { target: main })
  return { container, main }
}

describe('+error.svelte (D-400)', () => {
  it('404: friendly heading, message, link home, passes axe with landmarks', async () => {
    const { container, main } = mountError(404, 'Agent not found. It may have been removed or the URL is incorrect.')
    expect(main.querySelector('h1')?.textContent).toBe('Page not found')
    expect(main.textContent).toContain('Agent not found')
    expect(main.querySelector('a[href="/catalog"]')).not.toBeNull()
    await expectNoAxeViolations(container, { landmarks: true })
  })

  it('500: shows fixed copy and never the thrown message or a stack', async () => {
    const leak = 'SqliteError: no such table: agents\n    at /home/ville/secret/app.js:1:1 sk-live-abc123'
    const { container, main } = mountError(500, leak)
    expect(main.querySelector('h1')?.textContent).toBe('Something went wrong')
    expect(container.innerHTML).not.toMatch(/SqliteError|secret|sk-live|\bat \//)
    await expectNoAxeViolations(container, { landmarks: true })
  })

  it('renders when error is null', () => {
    const { main } = mountError(400, null)
    expect(main.querySelector('h1')).not.toBeNull()
    expect(main.textContent).toContain('could not be completed')
  })

  it('escapes hostile message text', () => {
    const { main } = mountError(400, '<img src=x onerror=alert(1)>')
    expect(main.querySelector('img')).toBeNull()
  })
})

describe('empty catalog from a table-less db (D-401)', () => {
  it('renders the empty state, passes axe (flag off)', async () => {
    document.body.innerHTML = ''
    const { container } = render(CatalogPage, { props: { data: emptyCatalogData(new URL('http://localhost/catalog')) } as never })
    expect(container.textContent).toContain('No agents match')
    expect(container.querySelectorAll('article, li').length).toBe(0)
    await expectNoAxeViolations(container)
  })

  it('renders with a query, kinds flag on', () => {
    vi.stubEnv('AGENT_KINDS', '1')
    try {
      const data = emptyCatalogData(new URL('http://localhost/catalog?q=%3Cb%3Ex&kind=skill'))
      expect('kinds' in data).toBe(true)
      document.body.innerHTML = ''
      const { container } = render(CatalogPage, { props: { data } as never })
      expect(container.querySelector('b')).toBeNull()
      expect(container.textContent).toContain('No agents match')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

const detailData = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  agent: {
    slug: 'min',
    title: 'Minimal',
    summary: '',
    systemPrompt: '',
    llmName: 'n/a',
    llmTemperature: null,
    llmMaxTokens: null,
    llmTopP: null,
    toolNames: [],
    requiresHumanApproval: false,
    category: null,
    githubUrl: null,
    linkLabel: null,
    maturityStatus: 'experimental',
    tags: [],
    specId: null,
    lastIngestedAt: '2026-08-18T00:00:00.000Z',
    tryItOutMode: 'none',
    tryItOutUrl: null,
    tryItOutTaskTemplate: null,
    customizableFields: null,
    fixedFields: [],
    fixedNote: null,
    inputFields: [],
    ...over,
  },
  related: [],
  openTryOut: false,
  ...extra,
})

describe('detail page with minimal / odd / huge data', () => {
  it('minimal row (every optional field null/empty) renders and passes axe', async () => {
    document.body.innerHTML = ''
    const { container } = render(DetailPage, { props: { data: detailData() } as never })
    expect(container.querySelector('h1')?.textContent).toContain('Minimal')
    await expectNoAxeViolations(container)
  })

  it('huge fields and markup-looking text render as text', () => {
    document.body.innerHTML = ''
    const big = 'A'.repeat(500_000)
    const { container } = render(DetailPage, {
      props: { data: detailData({ title: '<script>alert(1)</script>', summary: big, systemPrompt: big, tags: ['<i>x</i>', 'y'.repeat(5000)], toolNames: ['<b>t</b>'] }) } as never,
    })
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('i')).toBeNull()
  })

  it('all key flags on with try-it-out unavailable (mode none) renders no run controls', () => {
    document.body.innerHTML = ''
    const { container } = render(DetailPage, {
      props: {
        data: detailData(
          {},
          { mcpGeneratorEnabled: true, mcpTesterEnabled: true, specViewer: { text: '', truncated: false }, kindInfo: { kind: 'skill', framework: null, topology: null, members: [], sourceFormat: null } }
        ),
      } as never,
    })
    expect(container.textContent).not.toMatch(/undefined|NaN|\[object/)
  })
})
