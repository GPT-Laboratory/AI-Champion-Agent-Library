// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import { readable } from 'svelte/store'

const nav = vi.hoisted(() => ({ goto: vi.fn() }))
vi.mock('$app/navigation', () => ({ goto: nav.goto }))
vi.mock('$app/stores', () => ({
  page: readable({ url: new URL('http://localhost/catalog?category=devops') }),
}))

import Pagination from './Pagination.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

describe('Pagination accessibility', () => {
  beforeEach(() => {
    nav.goto.mockReset()
    nav.goto.mockResolvedValue(undefined)
  })

  it('is a nav named Pagination with named buttons and an aria-current indicator', () => {
    render(Pagination, { currentPage: 2, totalPages: 4 })
    const navEl = screen.getByRole('navigation', { name: 'Pagination' })
    expect(navEl.contains(screen.getByRole('button', { name: 'Previous page' }))).toBe(true)
    expect(navEl.contains(screen.getByRole('button', { name: 'Next page' }))).toBe(true)
    const indicator = screen.getByText('Page 2 of 4')
    expect(indicator.getAttribute('aria-current')).toBe('page')
    expect(indicator.getAttribute('aria-live')).toBe('polite')
  })

  it('disables Previous on the first page and Next on the last', () => {
    const a = render(Pagination, { currentPage: 1, totalPages: 3 })
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(false)
    a.unmount()
    render(Pagination, { currentPage: 3, totalPages: 3 })
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('navigates keeping focus and the other params', async () => {
    render(Pagination, { currentPage: 1, totalPages: 3 })
    const next = screen.getByRole('button', { name: 'Next page' })
    next.focus()
    await fireEvent.click(next)
    expect(nav.goto).toHaveBeenCalledWith('?category=devops&page=2', { keepFocus: true })
  })

  it('hands focus to the opposite button when navigating onto the last page', async () => {
    render(Pagination, { currentPage: 2, totalPages: 3 })
    await fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    // The page prop has not changed (goto is mocked), but the focus hand-off is explicit.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Previous page' }))
  })

  it('renders nothing for a single page and has no axe violations otherwise', async () => {
    const single = render(Pagination, { currentPage: 1, totalPages: 1 })
    expect(screen.queryByRole('navigation')).toBeNull()
    single.unmount()
    const { container } = render(Pagination, { currentPage: 2, totalPages: 4 })
    await expectNoAxeViolations(container)
  })
})
