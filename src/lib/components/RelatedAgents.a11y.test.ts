// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import RelatedAgents from './RelatedAgents.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

const make = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    slug: `agent-${i}`,
    title: `Agent ${i}`,
    summary: `Summary ${i}`,
    category: i % 2 ? null : 'ops',
  }))

describe('RelatedAgents', () => {
  it('renders an h2, a list and links to each agent', () => {
    render(RelatedAgents, { agents: make(3) })
    expect(screen.getByRole('heading', { level: 2, name: 'Related agents' })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/agents/agent-0', '/agents/agent-1', '/agents/agent-2'])
  })

  it('renders nothing when empty', () => {
    const { container } = render(RelatedAgents, { agents: [] })
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
    expect(container.querySelector('section')).toBeNull()
  })

  it('has unique link names', () => {
    render(RelatedAgents, { agents: make(4) })
    const names = screen.getAllByRole('link').map((l) => l.textContent)
    expect(new Set(names).size).toBe(4)
  })

  it('has no axe violations for 1 and 4 agents', async () => {
    for (const n of [1, 4]) {
      const { container, unmount } = render(RelatedAgents, { agents: make(n) })
      await expectNoAxeViolations(container)
      unmount()
    }
  })
})
