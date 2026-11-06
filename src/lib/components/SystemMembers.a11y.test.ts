// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import SystemMembers from './SystemMembers.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

const members = [
  { ref: 'a', name: 'Planner', role: 'manager', description: 'Plans the work.', slug: 'planner-agent' },
  { ref: 'b', name: 'Coder', role: 'worker', description: null, slug: null },
  { ref: 'c', name: 'Reviewer', role: 'worker', description: 'Reviews. '.repeat(80), slug: 'Bad Slug/../x' },
]

describe('SystemMembers', () => {
  it('renders heading, topology label, list items and safe links only', () => {
    render(SystemMembers, { members, topology: 'manager-workers', framework: 'crewai' })
    expect(screen.getByRole('heading', { level: 2, name: 'Members' })).toBeTruthy()
    expect(screen.getByText('Topology: Manager and workers')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('/agents/planner-agent')
    expect(links[0].getAttribute('aria-label')).toBe('View details: Planner')
  })

  it('handles empty members and no topology', () => {
    render(SystemMembers, { members: [], topology: null, framework: null })
    expect(screen.getByText('No members listed.')).toBeTruthy()
    expect(screen.queryByText(/Topology:/)).toBeNull()
  })

  it('shows unknown topology as raw text', () => {
    render(SystemMembers, { members: [], topology: 'mesh' })
    expect(screen.getByText('Topology: mesh')).toBeTruthy()
  })

  it('escapes markup in member text', () => {
    const { container } = render(SystemMembers, {
      members: [
        { ref: 'x', name: '<script>alert(1)</script>', role: 'peer', description: '<img src=x onerror=alert(1)>', slug: null },
      ],
      topology: 'swarm',
    })
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })

  it('has no axe violations', async () => {
    for (const props of [
      { members, topology: 'swarm', framework: 'crewai' },
      { members: [], topology: null, framework: null },
      { members: [members[2]], topology: 'pipeline', framework: null },
    ]) {
      const { container, unmount } = render(SystemMembers, props)
      await expectNoAxeViolations(container)
      unmount()
    }
  })
})
