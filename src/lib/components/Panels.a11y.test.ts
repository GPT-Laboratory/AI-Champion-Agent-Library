// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import TechAccordion from './TechAccordion.svelte'
import CustomizationPanel from './CustomizationPanel.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

const agent = {
  llmName: 'gpt-4o',
  llmTemperature: 0.7,
  llmMaxTokens: 1000,
  llmTopP: 0.9,
  toolNames: ['search'],
  requiresHumanApproval: true,
  systemPrompt: 'You are a helpful assistant.',
}

describe('TechAccordion accessibility', () => {
  it('has a focusable summary and a keyboard-reachable, named system prompt region', () => {
    const { container } = render(TechAccordion, { props: { agent } })
    const summary = container.querySelector('summary') as HTMLElement
    expect(summary.textContent).toContain('Technical Specification')
    expect(summary.getAttribute('tabindex')).toBeNull() // natively focusable
    expect(summary.className).toContain('focus-visible:ring-2')
    const prompt = screen.getByRole('region', { name: 'System prompt', hidden: true })
    expect(prompt.getAttribute('tabindex')).toBe('0')
  })

  it('has no axe violations', async () => {
    const { container } = render(TechAccordion, { props: { agent } })
    await expectNoAxeViolations(container)
  })
})

describe('CustomizationPanel accessibility', () => {
  it('is a complementary landmark named by its h2', () => {
    render(CustomizationPanel)
    const aside = screen.getByRole('complementary', { name: 'Customization Options' })
    expect(aside.querySelector('h2')?.textContent).toBe('Customization Options')
  })

  it('has no axe violations with customizable and fixed fields', async () => {
    const { container } = render(CustomizationPanel, {
      fields: ['llm.name'],
      fixed: ['llm.temperature'],
      values: { 'llm.temperature': '0.7' },
      fixedNote: 'Set by the creator.',
    })
    await expectNoAxeViolations(container)
  })
})
