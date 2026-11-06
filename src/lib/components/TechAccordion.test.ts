// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/svelte'
import TechAccordion from './TechAccordion.svelte'

const defaultAgent = {
  llmName: 'gpt-4o',
  llmTemperature: 0.7,
  llmMaxTokens: null,
  llmTopP: null,
  toolNames: ['search', 'calculator'],
  requiresHumanApproval: false,
  systemPrompt: 'You are a helpful assistant.',
}

describe('TechAccordion', () => {
  it('renders a details element', () => {
    const { container } = render(TechAccordion, { props: { agent: defaultAgent } })
    const details = container.querySelector('details')
    expect(details).not.toBeNull()
  })

  it('details element is closed by default (no open attribute)', () => {
    const { container } = render(TechAccordion, { props: { agent: defaultAgent } })
    const details = container.querySelector('details') as HTMLDetailsElement
    expect(details).not.toBeNull()
    expect(details.open).toBe(false)
  })

  it('displays Technical Specification as summary text', () => {
    const { container } = render(TechAccordion, { props: { agent: defaultAgent } })
    const summary = container.querySelector('summary')
    expect(summary).not.toBeNull()
    expect(summary!.textContent?.trim()).toContain('Technical Specification')
  })

  it('shows LLM name when expanded', () => {
    const { container } = render(TechAccordion, { props: { agent: defaultAgent } })
    const details = container.querySelector('details') as HTMLDetailsElement
    details.open = true
    expect(container.textContent).toContain('gpt-4o')
  })

  it('hides fields already shown as fixed in the customization panel', () => {
    const { container } = render(TechAccordion, {
      props: { agent: { ...defaultAgent, fixedFields: ['llm.name', 'llm.temperature', 'tools'] } },
    })
    const text = container.textContent ?? ''
    expect(text).not.toContain('gpt-4o')
    expect(text).not.toContain('Temperature:')
    expect(text).not.toContain('Tools:')
    expect(text).toContain('Human Approval:')
    expect(text).toContain('System Prompt:')
  })
})
