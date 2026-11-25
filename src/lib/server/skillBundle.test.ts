// The skill download (docs/skill-download.md): the zip, its README and the bundled helpers, run as a user would.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSkillHelpers } from '../../../scripts/build-skill-helpers'
import { SKILL_HELPERS, helperNames } from '../skillHelpers'
import { DDC_MIT_LICENSE } from './ddcLicense'
import { adaptsDdc, hasSkill, skillBundle } from './skillBundle'

const PROMPTS = join(process.cwd(), 'data/tryitout-prompts')
let tmp: string
let helpers: string
beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'skill-bundle-'))
  helpers = join(tmp, 'helpers')
  await buildSkillHelpers(helpers)
}, 120_000)
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const unzip = (b: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(b)).map(([k, v]) => [k, v]))
function extract(files: Record<string, Uint8Array>, into: string) {
  for (const [name, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(into, name)), { recursive: true })
    writeFileSync(join(into, name), bytes)
  }
}

describe('the helper bundles', () => {
  it('one dependency-free file per helper; each runs with plain node outside the repository', () => {
    expect(readdirSync(helpers).sort()).toEqual(helperNames().map((h) => `${h}.mjs`))
    for (const h of helperNames()) {
      const src = readFileSync(join(helpers, `${h}.mjs`), 'utf8')
      expect(src, h).not.toMatch(/from ['"](?!node:)[^'"]+['"]/) // no import except Node built-ins
      const r = spawnSync(process.execPath, [join(helpers, `${h}.mjs`)], { cwd: tmp, encoding: 'utf8' })
      expect(r.status, h).toBe(2) // usage error without arguments: it started and parsed its arguments
    }
  })

  it('every registered agent has a skill folder and the helper CLI exists', () => {
    for (const [slug, h] of Object.entries(SKILL_HELPERS)) {
      expect(existsSync(join(PROMPTS, slug, 'SKILL.md')), slug).toBe(true)
      expect(existsSync(join(process.cwd(), 'scripts', `${h.helper}.ts`)), h.helper).toBe(true)
      for (const step of [h.before, h.after]) if (step) expect(step.command, slug).toContain(`scripts/${h.helper}.mjs`)
    }
  })
})

describe('the download', () => {
  it('warranty: SKILL.md, the examples, the helper, the README with before and after, the DDC licence', async () => {
    const z = (await skillBundle('warranty-register-check', 'Warranty Register Check', PROMPTS, helpers))!
    expect(z.name).toBe('warranty-register-check-skill.zip')
    const files = unzip(z.bytes)
    expect(Object.keys(files).sort()).toEqual([
      'warranty-register-check/LICENSE-DDC.txt',
      'warranty-register-check/README.md',
      'warranty-register-check/SKILL.md',
      'warranty-register-check/examples/example-result.md',
      'warranty-register-check/examples/sample-warranty-register.txt',
      'warranty-register-check/scripts/warranty-status.mjs',
    ])
    const readme = strFromU8(files['warranty-register-check/README.md'])
    expect(readme).toContain('# Warranty Register Check: skill')
    expect(readme).toContain('**Before the skill (required).**')
    expect(readme).toContain('node scripts/warranty-status.mjs register.csv > upload.txt')
    expect(readme).toContain('node scripts/warranty-status.mjs register.csv result.md')
    expect(strFromU8(files['warranty-register-check/LICENSE-DDC.txt'])).toContain('Copyright (c) 2026 DataDrivenConstruction')

    // As a user would: unzip, run the helper on the example input and the example result.
    const out = join(tmp, 'w')
    extract(files, out)
    const dir = join(out, 'warranty-register-check')
    const before = execFileSync(process.execPath, ['scripts/warranty-status.mjs', 'examples/sample-warranty-register.txt'], { cwd: dir, encoding: 'utf8' })
    expect(before.trim()).toBe(readFileSync(join(dir, 'examples/sample-warranty-register.txt'), 'utf8').trim())
    const after = spawnSync(process.execPath, ['scripts/warranty-status.mjs', 'examples/sample-warranty-register.txt', 'examples/example-result.md'], { cwd: dir, encoding: 'utf8' })
    expect(after.status).toBe(0)
  })

  it('the rule agent: --prepare adds ## VALUES; the check takes the notes with --task', async () => {
    const files = unzip((await skillBundle('scope-rule-drafter', 'Scope Rule Drafter', PROMPTS, helpers))!.bytes)
    const out = join(tmp, 'r')
    extract(files, out)
    const dir = join(out, 'scope-rule-drafter')
    const prepared = execFileSync(process.execPath, ['scripts/rule-check.mjs', 'examples/sample-ebom-input.txt', '--prepare'], { cwd: dir, encoding: 'utf8' })
    expect(prepared).toContain('\n## VALUES\n')
    const readme = strFromU8(files['scope-rule-drafter/README.md'])
    expect(readme).toContain('Sprinkler piping is delivered by the sprinkler contractor.') // the example notes as the task
    expect(Object.keys(files)).not.toContain('scope-rule-drafter/LICENSE-DDC.txt') // own design
    expect(readme).toContain('**Before the skill (recommended).**') // the skill writes the list itself without it
  })

  it('an agent without a helper: no scripts and no before/after steps', async () => {
    const files = unzip((await skillBundle('rfi-generation-from-findings', 'RFI Generation', PROMPTS, helpers))!.bytes)
    expect(Object.keys(files).some((f) => f.includes('/scripts/'))).toBe(false)
    const readme = strFromU8(files['rfi-generation-from-findings/README.md'])
    expect(readme).not.toContain('Before the skill')
    expect(readme).not.toContain('After the skill')
    expect(readme).toContain('1. **The skill.**')
  })

  it('a helper that was not built is named in the README instead of shipped', async () => {
    const files = unzip((await skillBundle('qto-normalization', 'QTO', PROMPTS, join(tmp, 'nowhere')))!.bytes)
    expect(Object.keys(files).some((f) => f.endsWith('.mjs'))).toBe(false)
    expect(strFromU8(files['qto-normalization/README.md'])).toContain('not included in this installation')
  })

  it('no skill for an unknown or invalid slug; hasSkill agrees', async () => {
    expect(await skillBundle('no-such-agent', 'x', PROMPTS, helpers)).toBeNull()
    expect(await skillBundle('../etc', 'x', PROMPTS, helpers)).toBeNull()
    expect(await hasSkill('ifc-ebom-compiler', PROMPTS)).toBe(true)
    expect(await hasSkill('no-such-agent', PROMPTS)).toBe(false)
  })
})

describe('credits', () => {
  it('the licence constant is the text of docs/third-party-notices.md', () => {
    const doc = readFileSync('docs/third-party-notices.md', 'utf8')
    expect(/License text, reproduced verbatim:\n\n```\n([\s\S]*?)\n```/.exec(doc)![1]).toBe(DDC_MIT_LICENSE)
  })

  it('DDC-derived skills are recognised from their credit line; own designs are not', () => {
    const skill = (s: string) => readFileSync(join(PROMPTS, s, 'SKILL.md'), 'utf8')
    for (const s of ['warranty-register-check', 'product-sourcing-mbom', 'qto-normalization', 'clash-prioritization']) expect(adaptsDdc(skill(s)), s).toBe(true)
    for (const s of ['ifc-ebom-compiler', 'scope-rule-drafter', 'd2-code-validation', 'spooling-and-cutting']) expect(adaptsDdc(skill(s)), s).toBe(false)
  })
})
