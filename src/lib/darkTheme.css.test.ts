import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DARK_OKLCH, DARK_SWAP } from './a11y/contrastDark'

const css = readFileSync(join(process.cwd(), 'src/app.css'), 'utf8')

function varsIn(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}

describe('app.css dark theme block', () => {
  const dark = /html\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(css)
  const system = /@media \(prefers-color-scheme: dark\)\s*\{\s*html\[data-theme="system"\]\s*\{([^}]*)\}/.exec(css)

  it('declares the attribute-keyed dark variant', () => {
    expect(css).toContain('@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));')
  })
  it('dark and system blocks both exist and set color-scheme', () => {
    expect(dark).not.toBeNull()
    expect(system).not.toBeNull()
    expect(dark![1]).toContain('color-scheme: dark')
    expect(system![1]).toContain('color-scheme: dark')
  })
  it('both blocks carry exactly the DARK_OKLCH values the AA proof checks', () => {
    expect(varsIn(dark![1])).toEqual(DARK_OKLCH)
    expect(varsIn(system![1])).toEqual(DARK_OKLCH)
  })
  it('nothing dark is applied outside the attribute-keyed selectors', () => {
    const outside = css
      .replace(/html\[data-theme="dark"\]\s*\{[^}]*\}/, '')
      .replace(/@media \(prefers-color-scheme: dark\)[\s\S]*$/, '')
    expect(outside).not.toMatch(/color-scheme/)
    expect(outside).not.toMatch(/--color-(white|gray-\d+):/)
  })
})

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.svelte')) out.push(p)
  }
  return out
}

describe('colour coverage', () => {
  it('every colour token used by a component is remapped for dark mode', () => {
    const missing = new Set<string>()
    for (const f of walk(join(process.cwd(), 'src'))) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/\b(?:bg|text|border|ring|fill|stroke|from|to|divide|outline|decoration|accent)-(white|black|[a-z]+-\d{2,3})(?:\/\d+)?\b/g)) {
        if (!(m[1] in DARK_SWAP)) missing.add(`${m[1]} (${f.replace(process.cwd() + '/', '')})`)
      }
    }
    expect([...missing]).toEqual([])
  })
  it('components never use {@html}', () => {
    for (const f of walk(join(process.cwd(), 'src'))) expect(readFileSync(f, 'utf8'), f).not.toContain('{@html')
  })
})
