// @vitest-environment jsdom
// CR-03: a stored non-http(s) github URL must never become an href on the detail page.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/svelte'

vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: vi.fn(), replaceState: vi.fn() }))

import DetailPage from './[slug]/+page.svelte'

const data = (githubUrl: string | null) => ({
  agent: {
    slug: 'example-agent',
    title: 'Example Agent',
    summary: 'An example agent.',
    systemPrompt: 'You are helpful.',
    llmName: 'gpt-4o',
    llmTemperature: 0.7,
    llmMaxTokens: 1000,
    llmTopP: null,
    toolNames: [],
    requiresHumanApproval: false,
    category: null,
    githubUrl,
    linkLabel: 'Source',
    maturityStatus: 'beta',
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
  },
  related: [],
  openTryOut: false,
})

describe('detail page github link', () => {
  it('renders an https url as the link target', () => {
    const { container } = render(DetailPage, { props: { data: data('https://github.com/x/y') } as never })
    expect(container.querySelector('a[href="https://github.com/x/y"]')).not.toBeNull()
  })
  it.each(['javascript:alert(document.cookie)', 'data:text/html,x', 'vbscript:x'])('renders no link for %s', (url) => {
    const { container } = render(DetailPage, { props: { data: data(url) } as never })
    expect(container.innerHTML).not.toMatch(/javascript:|data:text|vbscript:/)
    expect(container.textContent).not.toContain('Source')
  })
})
