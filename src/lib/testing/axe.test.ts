// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from './axe'

function mount(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('expectNoAxeViolations', () => {
  it('passes for clean markup', async () => {
    const el = mount('<main><button>Go</button></main>')
    await expect(expectNoAxeViolations(el)).resolves.toBeUndefined()
  })

  it('reports an image without alt', async () => {
    const el = mount('<main><img src="x"></main>')
    await expect(expectNoAxeViolations(el)).rejects.toThrow(/image-alt/)
  })

  it('reports an unlabelled input', async () => {
    const el = mount('<main><input type="text"></main>')
    await expect(expectNoAxeViolations(el)).rejects.toThrow(/\[label\]/)
  })

  it('only checks landmarks when asked', async () => {
    const el = mount('<p>loose text</p>')
    await expect(expectNoAxeViolations(el)).resolves.toBeUndefined()
    await expect(expectNoAxeViolations(el, { landmarks: true })).rejects.toThrow(/region/)
  })
})
