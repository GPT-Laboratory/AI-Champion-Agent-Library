// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import FilterBar from './FilterBar.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

function props(overrides: Record<string, unknown> = {}) {
  return {
    categories: ['productivity', 'devops'],
    llms: ['gpt-4o'],
    maturityStatuses: ['beta', 'production'],
    selectedCategory: '',
    selectedLlm: '',
    selectedMaturity: '',
    onCategoryChange: vi.fn(),
    onLlmChange: vi.fn(),
    onMaturityChange: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  }
}

describe('FilterBar accessibility', () => {
  it('names every select and groups them under "Filter agents"', () => {
    render(FilterBar, props())
    const group = screen.getByRole('group', { name: 'Filter agents' })
    for (const name of ['Category', 'Model', 'Status']) {
      const select = screen.getByRole('combobox', { name })
      expect(group.contains(select)).toBe(true)
    }
  })

  it('moves focus to the Category select after Clear filters', async () => {
    const onClear = vi.fn()
    render(FilterBar, props({ selectedCategory: 'devops', onClear }))
    const clear = screen.getByRole('button', { name: 'Clear filters' })
    expect(clear.getAttribute('type')).toBe('button')
    clear.focus()
    await fireEvent.click(clear)
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Category' }))
  })

  it('has no axe violations (with and without active filters)', async () => {
    const a = render(FilterBar, props())
    await expectNoAxeViolations(a.container)
    a.unmount()
    const b = render(FilterBar, props({ selectedCategory: 'devops' }))
    await expectNoAxeViolations(b.container)
  })
})
