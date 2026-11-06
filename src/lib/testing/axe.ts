import axe from 'axe-core'

export interface AxeOptions {
  /**
   * Run page-level rules such as `region` (all content in landmarks). Default false
   * because isolated component renders have no landmarks. Page tests pass true.
   */
  landmarks?: boolean
  /** Extra rule ids to disable. */
  disable?: string[]
}

/**
 * Run axe-core against a rendered container and throw an actionable error on violations.
 *
 * `color-contrast` is disabled: jsdom has no layout/computed colours, so contrast is
 * covered by src/lib/a11y/contrast.test.ts instead.
 */
export async function expectNoAxeViolations(container: Element, opts: AxeOptions = {}): Promise<void> {
  const rules: Record<string, { enabled: boolean }> = {
    'color-contrast': { enabled: false },
  }
  if (!opts.landmarks) rules['region'] = { enabled: false }
  for (const id of opts.disable ?? []) rules[id] = { enabled: false }

  // Page-level rules (region, landmark-*) only apply when the audit context is the whole
  // document, so landmark mode audits the owner document. jsdom pages have no <title>
  // or lang, which SvelteKit's app.html supplies in production, so those are skipped.
  if (opts.landmarks) {
    for (const id of ['document-title', 'html-has-lang', 'html-lang-valid']) rules[id] = { enabled: false }
  }
  const context: axe.ElementContext = opts.landmarks ? container.ownerDocument : container
  const results = await axe.run(context, { rules, resultTypes: ['violations'] })
  if (results.violations.length === 0) return

  const lines = results.violations.map((v) => {
    const nodes = v.nodes
      .slice(0, 3)
      .map((n) => `    - ${n.html.length > 160 ? n.html.slice(0, 157) + '...' : n.html}`)
      .join('\n')
    return `[${v.id}] (${v.impact ?? 'n/a'}) ${v.help}\n${nodes}`
  })
  throw new Error(`axe found ${results.violations.length} accessibility violation(s):\n${lines.join('\n')}`)
}
