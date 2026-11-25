// src/lib/server/skillBundle.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// The skill download of an agent (docs/skill-download.md): a zip with the agent's skill folder in the Agent Skills
// layout, so it can be used outside this site by any agent that reads files:
//   <slug>/SKILL.md                 the instructions, as Try It Out uses them
//   <slug>/examples/...             the synthetic example input and, if saved, the expected result
//   <slug>/scripts/<helper>.mjs     the agent's deterministic helper, one file, plain `node` (only agents with one)
//   <slug>/README.md                what is in the folder and what to run before and after the skill
//   <slug>/LICENSE-DDC.txt          the DDC MIT licence, for skills that adapt a DDC skill
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { AgentIdSchema, PROMPTS_DIR } from './tryItOutPrompts'
import { loadTryItOutExample } from './tryItOutExample'
import { SKILL_HELPERS, type SkillHelper } from '../skillHelpers'
import { DDC_MIT_LICENSE, DDC_SOURCE } from './ddcLicense'

export const SKILL_HELPERS_DIR = process.env.SKILL_HELPERS_DIR ?? join(process.cwd(), 'skill-helpers')
/** Files of the prompt folder that are site configuration, not part of the skill. */
const SITE_ONLY = new Set(['example.yaml'])

/** True when the skill text says it adapts a DDC skill (its credit line), so the zip carries the DDC licence. */
export const adaptsDdc = (skill: string): boolean => /\bDDC skills?\b/i.test(skill) && !/No DDC basis/i.test(skill)

export interface ReadmeInput {
  slug: string
  title: string
  files: { skill: string; examples: string[]; helper: string | null }
  helper: SkillHelper | null
  helperMissing: boolean
  exampleTask: string | null
  exampleResultLabel: string | null
  ddc: boolean
}

/** The README.md of the download: what the files are and the order to run things in. Pure; exported for tests. */
export function skillReadme(r: ReadmeInput): string {
  const h = r.helper
  const lines = [
    `# ${r.title}: skill`,
    '',
    `The skill of the ${r.title} agent from the AIC Agent Library (AI Champion project), packaged to use outside the`,
    'library with any agent that can read files' + (h ? ' and run `node` 18 or newer (for the helper).' : '.'),
    'Every output is a draft for expert review. All example data is synthetic.',
    '',
    '## Files',
    '',
    `- \`SKILL.md\`: the instructions. It names its inputs \`input/task.txt\` and \`input/upload.txt\` and its output \`output/result.md\`; put the task and the file there, or give them to the agent directly.`,
    ...r.files.examples.map((f) =>
      f === 'examples/example-result.md'
        ? `- \`${f}\`: ${r.exampleResultLabel ?? 'the expected result for the example input.'}`
        : `- \`${f}\`: a synthetic example input.`,
    ),
    ...(h
      ? [
          r.helperMissing
            ? `- \`scripts/${h.helper}.mjs\`: not included in this installation (the helpers are built with \`npm run skills:build\`); take \`scripts/${h.helper}.ts\` from the library's repository and run it with \`npx tsx\` instead of \`node\`.`
            : `- \`scripts/${h.helper}.mjs\`: the agent's deterministic helper, one file with no dependencies and no network access.`,
        ]
      : []),
    ...(r.ddc ? ['- `LICENSE-DDC.txt`: the MIT licence of the DDC skill this skill adapts (see the credit line at the end of `SKILL.md`).'] : []),
    '',
    '## How to run it',
    '',
  ]
  let n = 1
  if (h?.before) {
    lines.push(`${n++}. **Before the skill (${h.before.required === false ? 'recommended' : 'required'}).** ${h.before.what}`, '', `   \`\`\`sh`, `   ${h.before.command}`, '   ```', '')
  }
  lines.push(
    `${n++}. **The skill.** Give the agent \`SKILL.md\`, the task${r.exampleTask ? ` (for the example: "${r.exampleTask.replace(/\s+/g, ' ').trim()}")` : ''} and the input file${h?.before ? ' from step 1' : ''}. It writes \`result.md\`.`,
    '',
  )
  if (h) {
    lines.push(`${n++}. **After the skill.** ${h.after.what}`, '', '   ```sh', `   ${h.after.command}`, '   ```', '')
    lines.push('The helper exits with 0 when everything checked matches, 1 when it found mismatches (listed), 2 when an input could not be read.', '')
  }
  lines.push('Try it on the example files in `examples/` first; the helper commands take any file names.', '')
  lines.push('## Credits', '', 'See the last line of `SKILL.md`.' + (r.ddc ? ` DDC skills: ${DDC_SOURCE} (MIT, \`LICENSE-DDC.txt\`).` : ''), '')
  return lines.join('\n')
}

/** The zip of an agent's skill, or null when the agent has no skill folder. */
export async function skillBundle(
  slug: string,
  title: string = slug,
  promptsDir: string = PROMPTS_DIR,
  helpersDir: string = SKILL_HELPERS_DIR,
): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (!AgentIdSchema.safeParse(slug).success) return null // before any path join
  const dir = join(promptsDir, slug)
  let names: string[]
  try {
    names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name).sort()
  } catch {
    return null
  }
  if (!names.includes('SKILL.md')) return null
  const skill = await readFile(join(dir, 'SKILL.md'), 'utf8')
  const example = await loadTryItOutExample(slug, promptsDir).catch(() => null)
  const exampleFiles = names.filter((n) => n !== 'SKILL.md' && !SITE_ONLY.has(n))

  const files: Record<string, Uint8Array> = { [`${slug}/SKILL.md`]: strToU8(skill) }
  for (const f of exampleFiles) files[`${slug}/examples/${f}`] = new Uint8Array(await readFile(join(dir, f)))

  const helper = SKILL_HELPERS[slug] ?? null
  let helperMissing = false
  if (helper) {
    try {
      files[`${slug}/scripts/${helper.helper}.mjs`] = new Uint8Array(await readFile(join(helpersDir, `${helper.helper}.mjs`)))
    } catch {
      helperMissing = true
    }
  }
  const ddc = adaptsDdc(skill)
  if (ddc) files[`${slug}/LICENSE-DDC.txt`] = strToU8(DDC_MIT_LICENSE + '\n')

  files[`${slug}/README.md`] = strToU8(
    skillReadme({
      slug,
      title,
      files: { skill: 'SKILL.md', examples: exampleFiles.map((f) => `examples/${f}`), helper: helper ? `scripts/${helper.helper}.mjs` : null },
      helper,
      helperMissing,
      exampleTask: example?.task ?? null,
      exampleResultLabel: example?.result?.label ?? null,
      ddc,
    }),
  )
  return { name: `${slug}-skill.zip`, bytes: zipSync(files, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') }) }
}

/** Whether the agent has a skill to download (for the link on its page). */
export async function hasSkill(slug: string, promptsDir: string = PROMPTS_DIR): Promise<boolean> {
  if (!AgentIdSchema.safeParse(slug).success) return false
  try {
    return (await readdir(join(promptsDir, slug))).includes('SKILL.md')
  } catch {
    return false
  }
}
