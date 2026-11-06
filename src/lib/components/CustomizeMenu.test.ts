// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import CustomizeMenu from './CustomizeMenu.svelte'

const LABELS = ['Configure fields', 'Connect your data', 'Change model']

async function openMenu() {
  render(CustomizeMenu)
  const button = screen.getByRole('button', { name: /customize/i })
  await fireEvent.click(button)
  await tick()
  await tick()
  return button
}

describe('CustomizeMenu', () => {
  it('renders a collapsed trigger with aria attributes', () => {
    render(CustomizeMenu)
    const button = screen.getByRole('button', { name: /customize/i })
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-controls')).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens a menu with three disabled items and Coming soon badges', async () => {
    const button = await openMenu()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const menu = screen.getByRole('menu')
    expect(menu.id).toBe(button.getAttribute('aria-controls'))
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(3)
    items.forEach((item, i) => {
      expect(item.textContent).toContain(LABELS[i])
      expect(item.getAttribute('aria-disabled')).toBe('true')
      expect(item.textContent).toContain('Coming soon')
      expect(item.tagName).toBe('BUTTON')
      expect((item as HTMLButtonElement).disabled).toBe(false)
    })
  })

  it('focuses the first item when opened', async () => {
    await openMenu()
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0])
  })

  it('shows an inline note on click and keeps the menu open', async () => {
    await openMenu()
    const items = screen.getAllByRole('menuitem')
    await fireEvent.click(items[1])
    expect(screen.getByRole('status').textContent).toBe(
      'Coming soon: Connect your data is not available yet.',
    )
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('Escape closes the menu and returns focus to the button', async () => {
    const button = await openMenu()
    await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await tick()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
  })

  it('arrow keys, Home and End move focus with wrapping', async () => {
    await openMenu()
    const items = screen.getAllByRole('menuitem')
    const menu = screen.getByRole('menu')
    await fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    await fireEvent.keyDown(menu, { key: 'ArrowDown' })
    await fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
    await fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[2])
    await fireEvent.keyDown(menu, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
    await fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toBe(items[2])
  })

  it('clicking outside closes the menu', async () => {
    await openMenu()
    await fireEvent.click(document.body)
    await tick()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('clicking the trigger again closes the menu', async () => {
    const button = await openMenu()
    await fireEvent.click(button)
    await tick()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
