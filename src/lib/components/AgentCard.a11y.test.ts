// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import AgentCard from './AgentCard.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

function agent(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'demo',
    title: 'Demo Agent',
    summary: 'Does demo things.',
    category: 'ops',
    maturityStatus: 'beta',
    tags: ['a', 'b'],
    tryItOutMode: 'none',
    tryItOutUrl: null,
    ...overrides,
  }
}

describe('AgentCard accessibility', () => {
  it('uses an h2 for the title (h1 is the page heading)', () => {
    render(AgentCard, { agent: agent() })
    expect(screen.getByRole('heading', { level: 2, name: 'Demo Agent' })).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull()
  })

  it('keeps visible link text inside the accessible name (2.5.3)', () => {
    render(AgentCard, { agent: agent({ tryItOutMode: 'runnable' }) })
    const details = screen.getByRole('link', { name: 'View details: Demo Agent' })
    expect(details.textContent?.trim()).toBe('View details')
    expect(details.getAttribute('aria-label')!.toLowerCase()).toContain(details.textContent!.trim().toLowerCase())
    const tryOut = screen.getByRole('link', { name: 'Try out Demo Agent' })
    expect(tryOut.getAttribute('aria-label')!.toLowerCase()).toContain('try out')
  })

  it('warns that an external Try out link opens a new tab', () => {
    render(AgentCard, { agent: agent({ tryItOutMode: 'external', tryItOutUrl: 'https://example.com/x' }) })
    const link = screen.getByRole('link', { name: /Try out Demo Agent \(opens in new tab\)/ })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('has no axe violations for each maturity and try-it-out mode', async () => {
    for (const a of [
      agent({ maturityStatus: 'production' }),
      agent({ maturityStatus: 'experimental', tryItOutMode: 'runnable' }),
      agent({ tryItOutMode: 'external', tryItOutUrl: 'https://example.com/x', category: null, tags: [] }),
    ]) {
      const { container, unmount } = render(AgentCard, { agent: a })
      await expectNoAxeViolations(container)
      unmount()
    }
  })
})
