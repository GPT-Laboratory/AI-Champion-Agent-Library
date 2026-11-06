import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// `vite build` rejects any export from a +page/+layout(.server) module other than the names
// SvelteKit knows (and any `_`-prefixed one). `npm run check` never builds, so guard it here.
const ROUTES = join(process.cwd(), 'src/routes')
const ALLOWED: Record<string, string[]> = {
  '+page.server.ts': ['load', 'actions', 'prerender', 'ssr', 'csr', 'trailingSlash', 'config', 'entries'],
  '+layout.server.ts': ['load', 'prerender', 'ssr', 'csr', 'trailingSlash', 'config'],
  '+page.ts': ['load', 'prerender', 'ssr', 'csr', 'trailingSlash', 'config', 'entries'],
  '+layout.ts': ['load', 'prerender', 'ssr', 'csr', 'trailingSlash', 'config'],
  '+server.ts': ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'fallback', 'prerender', 'trailingSlash', 'config', 'entries', 'csr', 'ssr'],
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

function exportedNames(src: string): string[] {
  const names: string[] = []
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) names.push(m[1])
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.split(/\s+as\s+/).pop()!.trim()
      if (name) names.push(name)
    }
  }
  return names
}

describe('SvelteKit route module exports', () => {
  const files = walk(ROUTES).filter((f) => Object.keys(ALLOWED).some((k) => f.endsWith('/' + k)))
  it('finds route modules to check', () => {
    expect(files.length).toBeGreaterThan(3)
  })
  for (const f of files) {
    it(`${f.slice(ROUTES.length)} exports only SvelteKit-allowed names`, () => {
      const kind = Object.keys(ALLOWED).find((k) => f.endsWith('/' + k))!
      const bad = exportedNames(readFileSync(f, 'utf8')).filter((n) => !ALLOWED[kind].includes(n) && !n.startsWith('_'))
      expect(bad).toEqual([])
    })
  }
})
