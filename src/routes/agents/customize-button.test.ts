// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/svelte'
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
  customizableFields: null as string[] | null,
  fixedFields: [] as string[],
  fixedNote: null,
}

function renderPage(overrides: Partial<typeof baseAgent>) {
  return render(Page, {
    props: { data: { agent: { ...baseAgent, ...overrides }, openTryOut: false } },
  })
}

describe('Customize button on the detail page', () => {
  it('is shown when there is no customization panel (no fields, mode none)', () => {
    const { container } = renderPage({ customizableFields: [], fixedFields: [] })
    expect(container.textContent).not.toContain('Customization Options')
    expect(screen.getByRole('button', { name: /customize/i })).toBeTruthy()
  })

  it('is shown for an agent with customizable and fixed fields', () => {
    renderPage({ customizableFields: ['llm.name'], fixedFields: ['tools'] })
    expect(screen.getByRole('button', { name: /customize/i })).toBeTruthy()
  })

  it('is shown for an agent with external try-it-out', () => {
    renderPage({
      tryItOutMode: 'external',
      tryItOutUrl: 'https://example.com/try/x',
      customizableFields: [],
      fixedFields: [],
    })
    expect(screen.getByRole('button', { name: /customize/i })).toBeTruthy()
  })
})
