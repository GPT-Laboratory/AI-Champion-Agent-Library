// Phase 35-01: labels, paths and github_url of agents 13-16 follow the alignment specs
// (docs/ddc-alignment/<slug>.md) and are identical in entry, notices and inventory.
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'

const notices = readFileSync('docs/third-party-notices.md', 'utf8')
const inventory = readFileSync('docs/consortium-agents-inventory.md', 'utf8')
const script = readFileSync('scripts/check-ddc-decoupling.sh', 'utf8')

const DDC_TREE = 'https://github.com/datadrivenconstruction/DDC_Skills_for_AI_Agents_in_Construction/tree/main/'
const LABEL_WORDS = ['built on', 'inspired by', 'loosely related to', 'no DDC basis']
const AGENTS: Record<string, number> = {
  'daily-report-cross-check': 13,
  'punch-list-closure-check': 14,
  'change-order-consistency-check': 15,
  'safety-observation-classification': 16,
}

function specLabel(slug: string): string {
  const lines = readFileSync(`docs/ddc-alignment/${slug}.md`, 'utf8').split('\n').filter((l) => l.startsWith('Label: '))
  expect(lines, `${slug} spec has exactly one Label line`).toHaveLength(1)
  return lines[0].slice('Label: '.length).trim()
}
const pathsOf = (label: string): string[] => label.match(/\d_DDC_[\w-]+\/[\w.-]+\/[\w-]+/g) ?? []
const wordOf = (label: string): string => LABEL_WORDS.find((w) => label.startsWith(w)) ?? ''

function filesOf(slug: string): string[] {
  const dir = `data/tryitout-prompts/${slug}`
  const extra = existsSync(dir) ? readdirSync(dir).map((f) => `${dir}/${f}`) : []
  return [`data/agents/${slug}.yaml`, ...extra]
}

describe('extras labels (agents 13-16)', () => {
  for (const [slug, agentNo] of Object.entries(AGENTS)) {
    describe(slug, () => {
      const label = specLabel(slug)
      const word = wordOf(label)
      const paths = pathsOf(label)
      const entry = readFileSync(`data/agents/${slug}.yaml`, 'utf8')

      it('spec label has a known word and at least one path', () => {
        expect(word).not.toBe('')
        if (word !== 'no DDC basis') expect(paths.length).toBeGreaterThan(0)
      })

      it('attribution carries the spec label, word and every path', () => {
        const attribution = entry.split('\n').find((l) => l.trim().startsWith('attribution:')) ?? ''
        expect(attribution).toContain(label)
        expect(attribution).toContain(word)
        for (const p of paths) expect(attribution).toContain(p)
      })

      it('github_url is the DDC tree URL of the primary verified path', () => {
        const url = entry.split('\n').find((l) => l.trim().startsWith('github_url:')) ?? ''
        if (word === 'no DDC basis') expect(url).toBe('')
        else expect(url).toContain(`"${DDC_TREE}${paths[0]}"`)
      })

      it('description or assumptions state the label', () => {
        const desc = entry.split('\n').find((l) => l.startsWith('description:')) ?? ''
        expect(desc).toContain(word)
      })

      it('notices and inventory rows carry the same label', () => {
        const noticeRow = notices.split('\n').find((l) => l.startsWith(`| ${slug} |`)) ?? ''
        expect(noticeRow).toContain(label)
        const invRow = inventory.split('\n').find((l) => l.startsWith(`| ${agentNo} |`)) ?? ''
        expect(invRow).toContain(label)
      })

      it('no file says "adapted from" or "follows the skill" unless the label is built on', () => {
        for (const f of filesOf(slug)) {
          const text = readFileSync(f, 'utf8')
          expect(text, f).not.toMatch(/adapted from/i)
          if (word !== 'built on') expect(text, f).not.toMatch(/follows? (the )?(DDC )?skill|built on the (DDC )?skill/i)
        }
      })
    })
  }

  it('the decoupling script scans the alignment doc of every slug', () => {
    expect(script).toContain('docs/ddc-alignment/$s.md')
    for (const slug of Object.keys(AGENTS)) expect(script).toContain(slug)
  })

  it('agent 15 states why change-order-manager is not the primary without a licence claim', () => {
    const entry = readFileSync('data/agents/change-order-consistency-check.yaml', 'utf8')
    expect(entry).not.toMatch(/third-party source licence/i)
  })
})
