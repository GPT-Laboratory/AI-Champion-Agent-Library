// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import CustomizeMenu from './CustomizeMenu.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

async function open() {
  const view = render(CustomizeMenu)
  const trigger = screen.getByRole('button', { name: /customize/i })
  await fireEvent.click(trigger)
  await tick()
  await tick()
  return { ...view, trigger }
}

describe('CustomizeMenu accessibility', () => {
  it('toggles aria-expanded and focuses the first item on open', async () => {
    const { trigger } = await open()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    await fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('moves focus with arrows, Home and End and wraps', async () => {
    await open()
    const items = screen.getAllByRole('menuitem')
    const menu = screen.getByRole('menu')
    await fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    await fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toBe(items[2])
    await fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
    await fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[2])
    await fireEvent.keyDown(menu, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const { trigger } = await open()
    await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('announces activation of a disabled item through the status note', async () => {
    await open()
    const note = screen.getByRole('status')
    expect(note.textContent).toBe('')
    await fireEvent.click(screen.getAllByRole('menuitem')[1])
    expect(screen.getByRole('status')).toBe(note)
    expect(note.textContent).toBe('Coming soon: Connect your data is not available yet.')
  })

  it('has no axe violations closed or open', async () => {
    const closed = render(CustomizeMenu)
    await expectNoAxeViolations(closed.container)
    closed.unmount()
    const { container } = await open()
    await expectNoAxeViolations(container)
  })
})
