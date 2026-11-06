// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { readable } from 'svelte/store'

vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: vi.fn() }))
vi.mock('$app/stores', () => ({ page: readable({ url: new URL('http://localhost/compare') }) }))

import Layout from '../+layout.svelte'
import Page from './+page.svelte'
import { buildCompareRows } from '$lib/compare'
import { expectNoAxeViolations } from '$lib/testing/axe'

const mk = (slug: string, o = {}) => ({
  slug, title: slug.toUpperCase(), summary: `sum ${slug}`, category: 'ops', tags: ['t'], llmName: slug === 'a' ? 'gpt' : 'claude',
  llmTemperature: null, toolNames: [], inputFields: [], requiresHumanApproval: false, maturityStatus: 'beta',
  tryItOutMode: 'none', githubUrl: 'https://github.com/x/' + slug, customizableFields: null, ...o,
})

function data(list: ReturnType<typeof mk>[], extra = {}) {
  return {
    max: 3, invalidCount: 0, truncated: false, unknown: [], kindsOn: false,
    agents: list.map((a) => ({ slug: a.slug, title: a.title, kind: null, framework: null })),
    rows: buildCompareRows(list as never),
    ...extra,
  }
}

function mount(d: unknown, layoutData: unknown = { user: { email: 'a@example.com' } }) {
  document.body.innerHTML = ''
  const empty = createRawSnippet(() => ({ render: () => '<span></span>' }))
  const { container } = render(Layout, { props: { data: layoutData, children: empty } as never })
  const main = container.querySelector('main') as HTMLElement
  render(Page, { target: main, props: { data: d } as never })
  return { container, main }
}

describe('/compare page', () => {
  it('renders a semantic table with caption, scoped headers, difference marker; passes axe', async () => {
    const { container, main } = mount(data([mk('a'), mk('b')]))
    const table = main.querySelector('table')!
    expect(table.querySelector('caption')?.textContent).toContain('Side-by-side comparison of 2 agents')
    expect([...table.querySelectorAll('thead th')].every((t) => t.getAttribute('scope') === 'col')).toBe(true)
    expect([...table.querySelectorAll('tbody th')].every((t) => t.getAttribute('scope') === 'row')).toBe(true)
    expect(table.querySelectorAll('thead th')).toHaveLength(3)
    expect(main.textContent).toContain('Differs')
    expect(main.querySelector('[role=region]')?.getAttribute('tabindex')).toBe('0')
    expect(main.querySelector('h1')?.textContent).toBe('Compare agents')
    await expectNoAxeViolations(container, { landmarks: true })
  })

  it('shows a friendly message for unknown agents and for too few agents; passes axe', async () => {
    const { container, main } = mount(data([mk('a')], { unknown: ['ghost'], invalidCount: 1 }))
    expect(main.querySelector('table')).toBeNull()
    expect(main.textContent).toContain('not found')
    expect(main.textContent).toContain('not valid agent identifiers')
    expect(main.textContent).toContain('Pick at least two agents')
    await expectNoAxeViolations(container, { landmarks: true })
  })

  it('shows the kind badge only when kinds are on', () => {
    const list = [mk('a'), mk('b')]
    const agents = [
      { slug: 'a', title: 'A', kind: 'system', framework: null },
      { slug: 'b', title: 'B', kind: 'agent', framework: null },
    ]
    expect(mount({ ...data(list, { kindsOn: true }), agents }).main.textContent).toContain('System')
    expect(mount({ ...data(list), agents }).main.textContent).not.toContain('System')
  })

  it('renders cell text as text, never as html', () => {
    const { main } = mount(data([mk('a', { summary: '<img src=x onerror=alert(1)>' }), mk('b')]))
    expect(main.querySelector('img')).toBeNull()
  })
})

describe('layout nav', () => {
  it('has no Compare link when the flag is off', () => {
    const { container } = mount(data([mk('a'), mk('b')]), { user: { email: 'a@example.com' } })
    expect(container.querySelector('nav')!.innerHTML).not.toContain('/compare')
  })
  it('has a Compare link when on', () => {
    const { container } = mount(data([mk('a'), mk('b')]), { user: { email: 'a@example.com' }, compareEnabled: true })
    expect(container.querySelector('nav a[href="/compare"]')).not.toBeNull()
  })
})
