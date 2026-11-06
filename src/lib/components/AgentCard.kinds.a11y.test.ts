// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import AgentCard from './AgentCard.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

const base = {
  slug: 'crew',
  title: 'Crew',
  summary: 'A crew',
  category: 'ops',
  maturityStatus: 'beta',
  tags: [],
  tryItOutMode: 'none',
  tryItOutUrl: null,
}

describe('AgentCard kind badge', () => {
  it('shows the badge for non-agent kinds and passes axe', async () => {
    const { container } = render(AgentCard, { agent: { ...base, kind: 'system', framework: 'crewai' } })
    expect(screen.getByText('System · crewai')).toBeTruthy()
    await expectNoAxeViolations(container)
  })

  it('renders no badge for kind agent or undefined, and identical markup', () => {
    const a = render(AgentCard, { agent: base })
    const plain = a.container.innerHTML
    a.unmount()
    const b = render(AgentCard, { agent: { ...base, kind: 'agent' } })
    expect(b.container.innerHTML).toBe(plain)
    expect(plain).not.toContain('rounded-full border')
  })
})
