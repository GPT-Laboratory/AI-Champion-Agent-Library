// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import CustomizeMenu from './CustomizeMenu.svelte'
import { expectNoAxeViolations } from '$lib/testing/axe'

const PLACEHOLDERS = ['Configure fields', 'Connect your data', 'Change model']

async function openMenu(props?: { generatorEnabled?: boolean; testerEnabled?: boolean }) {
  const view = props ? render(CustomizeMenu, { props }) : render(CustomizeMenu)
  const trigger = screen.getByRole('button', { name: /customize/i })
  await fireEvent.click(trigger)
  await tick()
  await tick()
  return { ...view, trigger }
}

describe('CustomizeMenu tester flag off (regression)', () => {
  it('renders identical DOM with no props and with testerEnabled false', async () => {
    const a = await openMenu()
    const norm = (h: string) => h.replace(/customize-menu-c\d+/g, 'customize-menu-ID')
    const htmlA = norm(a.container.innerHTML)
    a.unmount()
    const b = await openMenu({ testerEnabled: false })
    expect(norm(b.container.innerHTML)).toBe(htmlA)
    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => i.querySelector('span span')?.textContent)).toEqual(PLACEHOLDERS)
    for (const i of items) expect(i.getAttribute('aria-disabled')).toBe('true')
    expect(b.container.textContent).not.toContain('Test MCP servers')
    expect(b.container.querySelector('a')).toBeNull()
  })
})

describe('CustomizeMenu tester flag on', () => {
  it('adds one enabled link item to /mcp-test after the placeholders', async () => {
    await openMenu({ testerEnabled: true })
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(4)
    for (const i of items.slice(0, 3)) expect(i.getAttribute('aria-disabled')).toBe('true')
    const last = items[3]
    expect(last.tagName).toBe('A')
    expect(last.getAttribute('href')).toBe('/mcp-test')
    expect(last.getAttribute('aria-disabled')).toBeNull()
    expect(last.textContent).toContain('Test MCP servers')
  })

  it('with both flags there are five items and keyboard navigation wraps', async () => {
    await openMenu({ generatorEnabled: true, testerEnabled: true })
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(5)
    expect(items[3].textContent).toContain('Generate MCP')
    expect(items[4].getAttribute('href')).toBe('/mcp-test')
    const menu = screen.getByRole('menu')
    await fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toBe(items[4])
    await fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
    await fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[4])
  })

  it('has no axe violations with the menu open', async () => {
    const { container } = await openMenu({ testerEnabled: true })
    await expectNoAxeViolations(container)
  })
})
