// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import AgentCard from './AgentCard.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

const agent = {
  slug: 'demo', title: 'Demo Agent', summary: 'Does demo things.', category: 'ops', maturityStatus: 'beta',
  tags: ['a'], tryItOutMode: 'none', tryItOutUrl: null,
}

describe('AgentCard compare toggle', () => {
  it('without the compare prop the DOM has no checkbox or label (flag-off identical)', () => {
    const { container } = render(AgentCard, { agent })
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('label')).toBeNull()
  })

  it('renders a labelled, keyboard-operable checkbox that keeps visible text in its name', async () => {
    const onchange = vi.fn()
    const { container } = render(AgentCard, { agent, compare: { checked: false, disabled: false, onchange } })
    const box = screen.getByRole('checkbox', { name: 'Compare Demo Agent' }) as HTMLInputElement
    expect(box.tabIndex).toBe(0)
    expect(box.value).toBe('demo')
    await fireEvent.click(box)
    expect(onchange).toHaveBeenCalledWith(true)
    await expectNoAxeViolations(container)
  })

  it('can be disabled when the maximum is reached', () => {
    render(AgentCard, { agent, compare: { checked: false, disabled: true, onchange: () => {} } })
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true)
  })
})
