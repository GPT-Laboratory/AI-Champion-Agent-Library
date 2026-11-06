// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import ThemeToggle from './ThemeToggle.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.cookie = 'aic_theme=; Max-Age=0; Path=/'
  })

  it('is a labelled group of three native buttons with aria-pressed', async () => {
    const { container } = render(ThemeToggle, { theme: 'dark' })
    expect(screen.getByRole('group', { name: 'Colour theme' })).toBeTruthy()
    const btns = screen.getAllByRole('button')
    expect(btns.map((b) => b.textContent?.trim())).toEqual(['Light', 'Dark', 'System'])
    expect(btns.every((b) => b.tagName === 'BUTTON')).toBe(true)
    expect(btns.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    await expectNoAxeViolations(container)
  })

  it('click applies data-theme, stores a cookie and moves aria-pressed', async () => {
    render(ThemeToggle, { theme: 'system' })
    await fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.cookie).toContain('aic_theme=light')
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'System' }).getAttribute('aria-pressed')).toBe('false')
  })
})
