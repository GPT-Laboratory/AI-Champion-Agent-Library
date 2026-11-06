// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import CustomizeMenu from './CustomizeMenu.svelte'

const PLACEHOLDERS = ['Configure fields', 'Connect your data', 'Change model']

async function openMenu(props?: { generatorEnabled?: boolean }) {
  const view = props ? render(CustomizeMenu, { props }) : render(CustomizeMenu)
  const trigger = screen.getByRole('button', { name: /customize/i })
  await fireEvent.click(trigger)
  await tick()
  await tick()
  return { ...view, trigger }
}

describe('CustomizeMenu flag off (regression)', () => {
  it('renders identical DOM with no props and with generatorEnabled false', async () => {
    const a = await openMenu()
    const norm = (h: string) => h.replace(/customize-menu-c\d+/g, 'customize-menu-ID')
    const htmlA = norm(a.container.innerHTML)
    a.unmount()
    const b = await openMenu({ generatorEnabled: false })
    const htmlB = norm(b.container.innerHTML)
    expect(htmlB).toBe(htmlA)
    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => i.querySelector('span span')?.textContent)).toEqual(PLACEHOLDERS)
    for (const i of items) expect(i.getAttribute('aria-disabled')).toBe('true')
    expect(b.container.textContent).not.toContain('Generate MCP')
  })
})

describe('CustomizeMenu flag on', () => {
  it('adds a fourth enabled item and keeps the placeholders', async () => {
    await openMenu({ generatorEnabled: true })
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(4)
    for (const i of items.slice(0, 3)) expect(i.getAttribute('aria-disabled')).toBe('true')
    const fourth = items[3]
    expect(fourth.getAttribute('aria-disabled')).toBeNull()
    expect(fourth.textContent).toContain('Generate MCP')
    expect(fourth.textContent).toContain('Generate an MCP server from a schema or spec')
    expect(fourth.textContent).not.toContain('Coming soon')
  })

  it('navigation wraps over four items', async () => {
    await openMenu({ generatorEnabled: true })
    const items = screen.getAllByRole('menuitem')
    const menu = screen.getByRole('menu')
    await fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toBe(items[3])
    await fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
    await fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[3])
  })

  it('activating the item closes the menu and reveals the panel; closing returns focus to the trigger', async () => {
    const { trigger } = await openMenu({ generatorEnabled: true })
    await fireEvent.click(screen.getAllByRole('menuitem')[3])
    await tick()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('region', { name: 'Generate MCP server' })).toBeTruthy()
    await fireEvent.keyDown(screen.getByRole('region'), { key: 'Escape' })
    await tick()
    expect(screen.queryByRole('region')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('placeholder items still show the Coming soon note', async () => {
    await openMenu({ generatorEnabled: true })
    await fireEvent.click(screen.getAllByRole('menuitem')[0])
    expect(screen.getByRole('status').textContent).toBe('Coming soon: Configure fields is not available yet.')
  })
})
