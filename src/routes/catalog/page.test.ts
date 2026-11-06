// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import { readable } from 'svelte/store'

type NavCallback = (nav: { type: string }) => void
const nav = vi.hoisted(() => ({
  goto: vi.fn(),
  callbacks: [] as NavCallback[],
}))

vi.mock('$app/navigation', () => ({
  goto: nav.goto,
  afterNavigate: (cb: NavCallback) => {
    nav.callbacks.push(cb)
  },
}))
vi.mock('$app/stores', () => ({
  page: readable({ url: new URL('http://localhost/catalog') }),
}))

import Page from './+page.svelte'

function makeData(filters: Partial<{ category: string | null; llm: string | null; maturity: string | null; q: string | null }> = {}) {
  return {
    agents: [],
    total: 0,
    searchDegraded: false,
    page: 1,
    pageSize: 24,
    totalPages: 0,
    categories: ['alpha', 'beta'],
    llms: [],
    maturityStatuses: [],
    filters: { category: null, llm: null, maturity: null, q: null, ...filters },
  }
}

function mount(filters = {}) {
  return render(Page, { data: makeData(filters) } as never)
}

function fire(type: string) {
  for (const cb of nav.callbacks) cb({ type })
}

describe('catalog +page.svelte', () => {
  beforeEach(() => {
    nav.goto.mockReset()
    nav.callbacks.length = 0
  })

  describe('no-results message (WR-06 / security audit)', () => {
    it('is driven by the server query data.filters.q and breaks long words', () => {
      const { container } = mount({ q: 'zzz' })
      const h2 = container.querySelector('h2') as HTMLElement
      expect(h2.textContent).toBe('No agents match "zzz"')
      expect(h2.className).toContain('break-words')
    })

    it('caps the echoed query at 200 characters', () => {
      const { container } = mount({ q: 'x'.repeat(500) })
      const h2 = container.querySelector('h2') as HTMLElement
      expect(h2.textContent).toBe(`No agents match "${'x'.repeat(200)}…"`)
    })

    it('renders markup in the query as text, not elements', () => {
      const { container } = mount({ q: '<img src=x onerror=alert(1)>' })
      expect(container.querySelector('h2 img')).toBeNull()
      expect(container.querySelector('h2')!.textContent).toContain('<img src=x onerror=alert(1)>')
    })

    it('shows the filter message when there is no query', () => {
      const { container } = mount({ category: 'alpha' })
      expect(container.querySelector('h2')!.textContent).toBe('No agents match your filters')
    })
  })

  describe('state follows data on navigation (WR-06)', () => {
    it('re-seeds the category select when data.filters changes', async () => {
      const { container, rerender } = mount({ category: 'alpha' })
      const select = container.querySelector('#filter-category') as HTMLSelectElement
      expect(select.value).toBe('alpha')
      await rerender({ data: makeData({ category: 'beta' }) } as never)
      expect(select.value).toBe('beta')
      await rerender({ data: makeData() } as never)
      expect(select.value).toBe('')
    })

    it('re-creates the search input after an external (link) navigation', async () => {
      const { container, rerender } = mount({ q: 'foo' })
      expect((container.querySelector('input') as HTMLInputElement).value).toBe('foo')
      await rerender({ data: makeData({ q: null }) } as never)
      fire('link')
      await Promise.resolve()
      expect((container.querySelector('input') as HTMLInputElement).value).toBe('')
    })

    it('re-creates the search input after back/forward (popstate)', async () => {
      const { container, rerender } = mount({ q: 'foo' })
      await rerender({ data: makeData({ q: 'bar' }) } as never)
      fire('popstate')
      await Promise.resolve()
      expect((container.querySelector('input') as HTMLInputElement).value).toBe('bar')
    })

    it('keeps the input element (and focus) for the page-initiated goto navigation', async () => {
      const { container, rerender } = mount({ q: 'foo' })
      const input = container.querySelector('input') as HTMLInputElement
      await fireEvent.input(input, { target: { value: 'foo bar' } })
      await rerender({ data: makeData({ q: 'foo' }) } as never)
      fire('goto')
      await Promise.resolve()
      expect(container.querySelector('input')).toBe(input)
      expect(input.value).toBe('foo bar')
    })

    it('a category change builds the URL from current state and navigates', async () => {
      const { container } = mount({ q: 'sql' })
      const select = container.querySelector('#filter-category') as HTMLSelectElement
      await fireEvent.change(select, { target: { value: 'beta' } })
      expect(nav.goto).toHaveBeenCalledTimes(1)
      const url = nav.goto.mock.calls[0][0] as string
      expect(new URLSearchParams(url.slice(1)).get('category')).toBe('beta')
      expect(new URLSearchParams(url.slice(1)).get('q')).toBe('sql')
    })
  })

  it('shows the degraded-search notice only when flagged (WR-07)', () => {
    const a = mount()
    expect(a.container.textContent).not.toContain('Search is temporarily limited')
    expect(a.container.querySelector('[aria-live="polite"]')!.textContent).not.toContain('temporarily limited')
    a.unmount()
    const b = render(Page, { data: { ...makeData(), searchDegraded: true } } as never)
    expect(b.container.textContent).toContain('Search is temporarily limited')
    // Announced through the persistent live region (exists before the content changes).
    expect(b.container.querySelector('[aria-live="polite"]')!.textContent).toContain('Search is temporarily limited')
  })
})
