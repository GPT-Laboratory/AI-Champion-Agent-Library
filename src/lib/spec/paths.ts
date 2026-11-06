// Path helpers shared by the format adapters (Phase 13, WR-02). Pure.

/** Number of directories above the file: `a.yaml` is 0, `x/a.yaml` is 1. */
export function depthOf(path: string): number {
  return path.split('/').length - 1
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/** Stable copy ordered shallowest path first, then alphabetically (so `SKILL.md` beats `AAA/SKILL.md`). */
export function byShallowest<T>(items: readonly T[], pathOf: (t: T) => string): T[] {
  return items
    .map((item, i) => ({ item, i, path: pathOf(item) }))
    .sort((a, b) => depthOf(a.path) - depthOf(b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : a.i - b.i))
    .map((x) => x.item)
}

/** Warning naming the file that was used and the other candidates that were not. Null when none. */
export function ignoredWarning(label: string, used: string, ignored: readonly string[]): string | null {
  if (ignored.length === 0) return null
  const shown = ignored.slice(0, 5).join(', ')
  const more = ignored.length > 5 ? `, +${ignored.length - 5} more` : ''
  return `${label}: using ${used}; ${ignored.length} other file(s) ignored: ${shown}${more}`
}
