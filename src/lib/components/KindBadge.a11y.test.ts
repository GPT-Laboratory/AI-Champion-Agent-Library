// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/svelte'
import KindBadge from './KindBadge.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

describe('KindBadge', () => {
  it('renders text labels per kind', () => {
    const cases: [string, string][] = [
      ['system', 'System'],
      ['skill', 'Skill'],
      ['mcp-server', 'MCP server'],
      ['workflow', 'Workflow'],
      ['external-agent', 'External agent'],
      ['gizmo', 'Gizmo'],
    ]
    for (const [kind, text] of cases) {
      const { container, unmount } = render(KindBadge, { kind })
      expect(container.textContent?.trim()).toBe(text)
      unmount()
    }
  })

  it('appends the framework and renders nothing for agent', () => {
    const a = render(KindBadge, { kind: 'system', framework: 'crewai' })
    expect(a.container.textContent?.trim()).toBe('System · crewai')
    a.unmount()
    const b = render(KindBadge, { kind: 'agent', framework: 'crewai' })
    expect(b.container.textContent?.trim()).toBe('')
  })

  it('has no axe violations', async () => {
    const { container } = render(KindBadge, { kind: 'system', framework: 'crewai' })
    await expectNoAxeViolations(container)
  })
})
