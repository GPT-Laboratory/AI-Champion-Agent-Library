// Server-only. Static scanner for the relative-import closure of the in-container driver (E9 defects D1/D2).
// It reads import/export-from specifiers and dynamic imports with a literal specifier; non-relative specifiers
// (packages, node: builtins) are ignored because the image provides them.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

/** Relative specifiers ('./x', '../y') of a TypeScript source. Comments are blanked first. */
export function scanRelativeImports(source: string): string[] {
  const src = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
  const out = new Set<string>()
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[^'";]*?\sfrom\s*['"]([^'"\n]+)['"]/g,
    /\bimport\s*['"]([^'"\n]+)['"]/g,
    /\bexport\s*\*\s*from\s*['"]([^'"\n]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g
  ]
  for (const re of patterns) for (const m of src.matchAll(re)) if (m[1].startsWith('./') || m[1].startsWith('../')) out.add(m[1])
  return [...out].sort()
}

const CANDIDATES = ['', '.ts', '.json', '.mjs', '/index.ts']

/** Resolves a relative specifier from a file (repo-relative path, forward slashes) to a repo-relative path, or null. */
export function resolveRelative(root: string, fromRel: string, spec: string): string | null {
  const base = resolve(root, dirname(fromRel), spec)
  // ESM-style './x.js' names the TypeScript source './x.ts' (tsx maps it).
  const bases = /\.m?js$/.test(spec) ? [base, base.replace(/\.m?js$/, '.ts')] : [base]
  for (const c of CANDIDATES)
    for (const b of bases) {
      const p = b + c
      if (existsSync(p) && statSync(p).isFile()) {
        const rel = relative(root, p).split(sep).join('/')
        return rel.startsWith('..') ? null : rel
      }
    }
  return null
}

/** Transitive relative-import closure of the entry files; unresolved specifiers are reported, not thrown. */
export function importClosure(root: string, entries: string[]): { files: string[]; unresolved: { from: string; spec: string }[] } {
  const seen = new Set<string>()
  const unresolved: { from: string; spec: string }[] = []
  const queue = [...entries]
  while (queue.length > 0) {
    const f = queue.pop() as string
    if (seen.has(f)) continue
    seen.add(f)
    if (!f.endsWith('.ts')) continue
    let text: string
    try {
      text = readFileSync(join(root, f), 'utf8')
    } catch {
      continue
    }
    for (const spec of scanRelativeImports(text)) {
      const r = resolveRelative(root, f, spec)
      if (r) queue.push(r)
      else unresolved.push({ from: f, spec })
    }
  }
  return { files: [...seen].sort(), unresolved }
}
