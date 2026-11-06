// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'
import Page from './[slug]/+page.svelte'

const baseAgent = {
  slug: 'example-agent',
  title: 'Example Agent',
  summary: 'An example agent used for testing.',
  systemPrompt: 'You are a helpful assistant.',
  llmName: 'gpt-4o',
  llmTemperature: 0.7,
  llmMaxTokens: null,
  llmTopP: null,
  toolNames: [],
  requiresHumanApproval: false,
  category: null,
  githubUrl: null as string | null,
  maturityStatus: 'experimental',
  tags: [],
  specId: null,
  lastIngestedAt: '2026-08-18T00:00:00.000Z',
  tryItOutMode: 'none',
  tryItOutUrl: null as string | null,
  tryItOutTaskTemplate: null,
}

function renderPage(overrides: Partial<typeof baseAgent> = {}, openTryOut = false) {
  return render(Page, { props: { data: { agent: { ...baseAgent, ...overrides }, openTryOut } } })
}

describe('Try It Out affordance', () => {
  it('external mode with url renders a single "Try it out" link that opens in a new tab', () => {
    const { container } = renderPage({
      tryItOutMode: 'external',
      tryItOutUrl: 'https://example.com/try/x',
    })

    const links = Array.from(container.querySelectorAll('a')).filter((a) =>
      /try it out/i.test(a.textContent ?? '')
    )

    expect(links).toHaveLength(1)
    const link = links[0]
    expect(link.getAttribute('href')).toBe('https://example.com/try/x')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  function tryItOutElements(container: HTMLElement) {
    return Array.from(container.querySelectorAll('a, button')).filter((el) =>
      /try it out/i.test(el.textContent ?? '')
    )
  }

  function tryItOutToggle(container: HTMLElement) {
    return Array.from(container.querySelectorAll('button')).filter((b) =>
      /try it out/i.test(b.textContent ?? '')
    )
  }

  it('runnable mode hides the TryItOutPanel on initial render', () => {
    const { container } = renderPage({ tryItOutMode: 'runnable' })

    const headings = Array.from(container.querySelectorAll('h2')).filter((h) =>
      /try it out/i.test(h.textContent ?? '')
    )
    expect(headings).toHaveLength(0)

    expect(container.querySelector('#tryitout-task')).toBeNull()

    const buttons = Array.from(container.querySelectorAll('button'))
    const runButton = buttons.find((b) => (b.textContent ?? '').trim() === 'Run')
    expect(runButton).toBeUndefined()
  })

  it('opens the runnable panel from the catalog deep link', () => {
    const { container } = renderPage({ tryItOutMode: 'runnable' }, true)

    expect(container.querySelector('#tryitout-task')).not.toBeNull()
    expect(container.querySelector('[aria-expanded="true"]')).not.toBeNull()
  })

  it('runnable mode renders an enabled "Try it out" toggle with a down arrow', () => {
    const { container } = renderPage({ tryItOutMode: 'runnable' })

    const toggles = tryItOutToggle(container)
    expect(toggles).toHaveLength(1)

    const toggle = toggles[0]
    expect(toggle.textContent).toContain('↓')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.disabled).toBe(false)
  })

  it('clicking the toggle reveals the existing TryItOutPanel inline below the control', async () => {
    const { container } = renderPage({ tryItOutMode: 'runnable' })

    const toggle = tryItOutToggle(container)[0]
    await fireEvent.click(toggle)
    await tick()

    const headings = Array.from(container.querySelectorAll('h2')).filter((h) =>
      /try it out/i.test(h.textContent ?? '')
    )
    expect(headings).toHaveLength(1)

    expect(container.querySelector('#tryitout-task')).not.toBeNull()

    const buttons = Array.from(container.querySelectorAll('button'))
    const runButton = buttons.find((b) => (b.textContent ?? '').trim() === 'Run')
    expect(runButton).not.toBeUndefined()

    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    const panelHeading = headings[0]
    expect(
      toggle.compareDocumentPosition(panelHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('clicking the toggle a second time collapses the panel again', async () => {
    const { container } = renderPage({ tryItOutMode: 'runnable' })

    const toggle = tryItOutToggle(container)[0]
    await fireEvent.click(toggle)
    await tick()
    await fireEvent.click(toggle)
    await tick()

    expect(container.querySelector('#tryitout-task')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('none mode renders nothing for Try It Out, but still renders the GitHub link', () => {
    const { container } = renderPage({
      tryItOutMode: 'none',
      githubUrl: 'https://github.com/example/repo',
    })

    expect(tryItOutElements(container)).toHaveLength(0)

    const githubLink = Array.from(container.querySelectorAll('a')).find(
      (a) => a.getAttribute('href') === 'https://github.com/example/repo'
    )
    expect(githubLink).not.toBeUndefined()
  })

  it('null/missing mode renders nothing, without crashing', () => {
    const { container } = renderPage({ tryItOutMode: null as unknown as string })

    expect(tryItOutElements(container)).toHaveLength(0)
  })

  it('external mode with a missing url renders nothing (malformed row)', () => {
    const { container } = renderPage({ tryItOutMode: 'external', tryItOutUrl: null })

    expect(tryItOutElements(container)).toHaveLength(0)
  })
})
