// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/svelte'
import CustomizationPanel from './CustomizationPanel.svelte'

describe('CustomizationPanel', () => {
  it('renders Customization Options heading', () => {
    const { getByText } = render(CustomizationPanel)
    expect(getByText('Customization Options')).toBeTruthy()
  })

  it('renders all 4 tailorable fields', () => {
    const { getByText } = render(CustomizationPanel)
    expect(getByText('Language Model')).toBeTruthy()
    expect(getByText('Temperature')).toBeTruthy()
    expect(getByText('System Prompt')).toBeTruthy()
    expect(getByText('Tools')).toBeTruthy()
  })

  it('shows Customizable badge for each field', () => {
    const { container } = render(CustomizationPanel)
    const badges = container.querySelectorAll('span')
    const customizableBadges = Array.from(badges).filter(
      (span) => span.textContent?.trim() === 'Customizable'
    )
    expect(customizableBadges).toHaveLength(4)
  })

  it('renders only the fields the agent declares as customizable', () => {
    const { queryByText } = render(CustomizationPanel, { props: { fields: ['systemPrompt'] } })
    expect(queryByText('System Prompt')).toBeTruthy()
    expect(queryByText('Temperature')).toBeNull()
  })

  it('shows fixed fields with their value and no Customizable badge', () => {
    const { getByText, container } = render(CustomizationPanel, {
      props: { fields: [], fixed: ['llm.name'], values: { 'llm.name': 'gpt-5.6' } },
    })
    expect(getByText('Language Model')).toBeTruthy()
    expect(getByText('gpt-5.6')).toBeTruthy()
    const badges = Array.from(container.querySelectorAll('span')).map((s) => s.textContent?.trim())
    expect(badges).toContain('Fixed')
    expect(badges).not.toContain('Customizable')
  })
})
