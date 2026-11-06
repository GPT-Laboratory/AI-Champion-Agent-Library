// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import { readable } from 'svelte/store'

const nav = vi.hoisted(() => ({ goto: vi.fn() }))
vi.mock('$app/navigation', () => ({ goto: nav.goto, afterNavigate: vi.fn() }))
vi.mock('$app/stores', () => ({ page: readable({ url: new URL('http://localhost/catalog') }) }))

import Page from './+page.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

const ag = (slug: string) => ({
  slug, title: `Agent ${slug}`, summary: 's', category: 'ops', maturityStatus: 'beta', tags: [], tryItOutMode: 'none', tryItOutUrl: null,
  llmName: 'gpt', toolNames: [], inputFields: [],
})
const base = (extra = {}) => ({
  agents: ['a', 'b', 'c', 'd'].map(ag), total: 4, searchDegraded: false, page: 1, pageSize: 24, totalPages: 1,
  categories: [], llms: [], maturityStatuses: [], filters: { category: null, llm: null, maturity: null, q: null }, ...extra,
})

beforeEach(() => nav.goto.mockReset())

describe('catalog page with AGENT_COMPARE', () => {
  it('flag off: no form, checkbox, status region or compare text', () => {
    const { container } = render(Page, { data: base() } as never)
    expect(container.querySelector('form[action="/compare"]')).toBeNull()
    expect(container.querySelector('input[type=checkbox]')).toBeNull()
    expect(container.innerHTML).not.toMatch(/compare/i)
  })

  it('flag on: GET form to /compare, labelled checkboxes, live region, passes axe', async () => {
    const { container } = render(Page, { data: base({ compareEnabled: true, compare: ['a'] }) } as never)
    const form = container.querySelector('form[action="/compare"]') as HTMLFormElement
    expect(form.method).toBe('get')
    const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type=checkbox][name=agents]')]
    expect(boxes).toHaveLength(4)
    expect(boxes[0].checked).toBe(true)
    expect(boxes[0].closest('label')?.textContent).toContain('Compare')
    expect(container.querySelector('[role=status]')?.textContent).toBe('1 of 3 agents selected for comparison')
    await expectNoAxeViolations(container)
  })

  it('caps selection at 3: remaining boxes disabled, URL updated, count announced', async () => {
    const { container } = render(Page, { data: base({ compareEnabled: true, compare: ['a', 'b'] }) } as never)
    const boxes = () => [...container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
    await fireEvent.click(boxes()[2])
    expect(nav.goto).toHaveBeenCalled()
    expect(String(nav.goto.mock.calls.at(-1)![0])).toContain('compare=a%2Cb%2Cc')
    expect(container.querySelector('[role=status]')?.textContent).toBe('3 of 3 agents selected for comparison')
    expect(boxes()[3].disabled).toBe(true)
    expect(boxes()[0].disabled).toBe(false)
  })

  it('selected slugs not on this page are carried as hidden inputs', () => {
    const { container } = render(Page, { data: base({ compareEnabled: true, compare: ['zzz'] }) } as never)
    expect(container.querySelector('input[type=hidden][name=agents][value=zzz]')).not.toBeNull()
  })
})
