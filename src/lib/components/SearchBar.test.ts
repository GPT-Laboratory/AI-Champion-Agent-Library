// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import SearchBar from './SearchBar.svelte'

describe('SearchBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('has role=search, a labeled input, initial value, and no submit button', () => {
    const { container } = render(SearchBar, { value: 'abc', onsearch: vi.fn() })
    expect(container.querySelector('[role="search"]')).not.toBeNull()
    const input = container.querySelector('input#agent-search') as HTMLInputElement
    expect(input.type).toBe('search')
    expect(input.value).toBe('abc')
    expect(container.querySelector('label[for="agent-search"]')?.textContent).toContain('Search agents')
    expect(container.querySelector('button[type="submit"]')).toBeNull()
    expect(container.querySelector('form')).toBeNull()
  })

  it('debounces rapid input into one trimmed call', async () => {
    const onsearch = vi.fn()
    const { container } = render(SearchBar, { onsearch })
    const input = container.querySelector('input') as HTMLInputElement
    await fireEvent.input(input, { target: { value: 'h' } })
    await fireEvent.input(input, { target: { value: 'hv' } })
    await fireEvent.input(input, { target: { value: ' hvac ' } })
    vi.advanceTimersByTime(199)
    expect(onsearch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onsearch).toHaveBeenCalledTimes(1)
    expect(onsearch).toHaveBeenCalledWith('hvac')
  })

  it('Enter does not trigger extra calls', async () => {
    const onsearch = vi.fn()
    const { container } = render(SearchBar, { onsearch })
    const input = container.querySelector('input') as HTMLInputElement
    await fireEvent.input(input, { target: { value: 'x' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    vi.advanceTimersByTime(500)
    expect(onsearch).toHaveBeenCalledTimes(1)
  })

  it('announces counts in a polite live region', async () => {
    const onsearch = vi.fn()
    const { container, rerender } = render(SearchBar, { onsearch, count: 5 })
    const live = container.querySelector('[aria-live="polite"]') as HTMLElement
    expect(live.className).toContain('sr-only')
    expect(live.textContent).toBe('5 agents found')
    await rerender({ onsearch, count: 1 })
    expect(live.textContent).toBe('1 agent found')
    await rerender({ onsearch, count: null })
    expect(live.textContent).toBe('')
  })

  it('clears a pending timer on unmount', async () => {
    const onsearch = vi.fn()
    const { container, unmount } = render(SearchBar, { onsearch })
    await fireEvent.input(container.querySelector('input')!, { target: { value: 'x' } })
    unmount()
    vi.advanceTimersByTime(500)
    expect(onsearch).not.toHaveBeenCalled()
  })

  it('clear button calls onsearch with empty string immediately', async () => {
    const onsearch = vi.fn()
    const { getByText } = render(SearchBar, { value: 'abc', onsearch })
    await fireEvent.click(getByText('Clear search'))
    expect(onsearch).toHaveBeenCalledWith('')
  })

  it('limits the input to 200 characters', () => {
    const { container } = render(SearchBar, { onsearch: vi.fn() })
    expect(container.querySelector('input')!.getAttribute('maxlength')).toBe('200')
  })
})

