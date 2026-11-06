// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { readable } from 'svelte/store'

vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: vi.fn(), replaceState: vi.fn() }))
vi.mock('$app/stores', () => ({ page: readable({ url: new URL('http://localhost/mcp-test') }) }))

import Layout from '../+layout.svelte'
import Page from './+page.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'
import { CASES, SUBJECTS } from '$lib/components/mcpTestFixtures'

describe('/mcp-test page', () => {
  it('renders heading, note and panel inside the layout main and passes axe with landmarks', async () => {
    const data = { subjects: SUBJECTS, cases: CASES }
    document.body.innerHTML = ''
    const empty = createRawSnippet(() => ({ render: () => '<span></span>' }))
    const { container } = render(Layout, { props: { data: { user: { email: 'a@example.com' } }, children: empty } as never })
    const main = container.querySelector('main') as HTMLElement
    render(Page, { target: main, props: { data } as never })
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(main.querySelector('h1')?.textContent).toBe('MCP test platform')
    expect(main.textContent).toContain('score the scorer fixtures, not a real generator')
    expect(main.querySelector('form')).not.toBeNull()
    const levels = [...main.querySelectorAll('h1,h2,h3,h4')].map((h) => Number(h.tagName[1]))
    expect(levels.every((l, i) => i === 0 || l <= levels[i - 1] + 1)).toBe(true)
    await expectNoAxeViolations(container, { landmarks: true })
  })
})

