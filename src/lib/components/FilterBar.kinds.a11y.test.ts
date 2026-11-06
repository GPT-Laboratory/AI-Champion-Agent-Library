// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import FilterBar from './FilterBar.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

function props(overrides: Record<string, unknown> = {}) {
  return {
    categories: ['ops'],
    llms: ['gpt-4o'],
    maturityStatuses: ['beta'],
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

describe('FilterBar Type select', () => {
  it('is absent without kinds or with a single kind', () => {
    const a = render(FilterBar, props())
    expect(screen.queryByRole('combobox', { name: 'Type' })).toBeNull()
    a.unmount()
    render(FilterBar, props({ kinds: ['agent'] }))
    expect(screen.queryByRole('combobox', { name: 'Type' })).toBeNull()
  })

  it('renders a labelled select, reports changes and passes axe', async () => {
    const onKindChange = vi.fn()
    const { container } = render(FilterBar, props({ kinds: ['agent', 'system'], onKindChange }))
    const select = screen.getByRole('combobox', { name: 'Type' })
    await fireEvent.change(select, { target: { value: 'system' } })
    expect(onKindChange).toHaveBeenCalledWith('system')
    await expectNoAxeViolations(container)
  })

  it('shows Clear filters when only the kind is active', () => {
    render(FilterBar, props({ kinds: ['agent', 'system'], selectedKind: 'system' }))
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy()
  })
})
