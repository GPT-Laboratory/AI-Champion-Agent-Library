// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import SearchBar from './SearchBar.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

describe('SearchBar accessibility', () => {
  it('exposes a searchbox named "Search agents" inside the search landmark', () => {
    render(SearchBar, { onsearch: vi.fn() })
    const landmark = screen.getByRole('search')
    const box = screen.getByRole('searchbox', { name: 'Search agents' })
    expect(landmark.contains(box)).toBe(true)
  })

  it('has a live region in the DOM before its content changes, and updates the text', async () => {
    const { container, rerender } = render(SearchBar, { onsearch: vi.fn() })
    const region = container.querySelector('[aria-live="polite"]') as HTMLElement
    expect(region).not.toBeNull()
    expect(region.textContent).toBe('')

    await rerender({ onsearch: vi.fn(), count: 3 })
    expect(container.querySelector('[aria-live="polite"]')).toBe(region)
    expect(region.textContent).toBe('3 agents found')

    await rerender({ onsearch: vi.fn(), count: 1 })
    expect(region.textContent).toBe('1 agent found')

    await rerender({ onsearch: vi.fn(), count: 0, message: 'Search is temporarily limited.' })
    expect(region.textContent).toBe('0 agents found. Search is temporarily limited.')
    expect(region.getAttribute('aria-atomic')).toBe('true')
  })

  it('shows Clear search only when there is text, activates by keyboard-equivalent click, and refocuses the input', async () => {
    const onsearch = vi.fn()
    render(SearchBar, { value: 'hvac', onsearch })
    const clear = screen.getByRole('button', { name: 'Clear search' })
    expect(clear.tagName).toBe('BUTTON')
    clear.focus()
    await fireEvent.click(clear)
    expect(onsearch).toHaveBeenCalledWith('')
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('searchbox'))
  })

  it('has no axe violations', async () => {
    const { container } = render(SearchBar, { value: 'abc', onsearch: vi.fn(), count: 2 })
    await expectNoAxeViolations(container)
  })
})
