// src/lib/server/tryItOutExample.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// An agent's optional Try It Out example lives in one place: data/tryitout-prompts/<slug>/example.yaml, next to
// SKILL.md. It names a default task (prefilled), a default input file and a saved result, both files in the same
// folder. The panel shows the saved result without a model call, so visitors can see what input the agent needs
// and what it returns without spending tokens. No example.yaml = no example; the panel is unchanged.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { AgentIdSchema, PROMPTS_DIR } from './tryItOutPrompts'
import type { TryItOutExample } from '../tryItOutExample'

export const EXAMPLE_FILE = 'example.yaml'
/** The jobs API upload cap (MAX_UPLOAD_BYTES): an example must be something a visitor could submit. */
export const MAX_EXAMPLE_BYTES = 200 * 1024

// A bare file name inside the agent's folder: no separators, no leading dot (traversal guard, as T3-2).
const FileName = z
  .string()
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'must be a file name in the agent folder')

const ExampleSchema = z
  .object({
    task: z.string().trim().min(1).max(MAX_EXAMPLE_BYTES),
    // Optional panel wording, for agents whose task box is not a free task (e.g. the rules of scope-rule-drafter).
    task_label: z.string().trim().min(1).max(100).optional(),
    file_label: z.string().trim().min(1).max(100).optional(),
    hint: z.string().trim().min(1).max(400).optional(),
    task_placeholder: z.string().trim().min(1).max(200).optional(),
    file: FileName.optional(),
    result: FileName.optional(),
    // Required with a result: the panel must say where a saved result came from (helper, model run, ...).
    result_label: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine((e) => !e.result || e.result_label, { message: 'result_label is required when result is set', path: ['result_label'] })

async function readCapped(dir: string, name: string): Promise<string> {
  const buf = await readFile(join(dir, name))
  if (buf.byteLength > MAX_EXAMPLE_BYTES) throw new Error(`${name} exceeds ${MAX_EXAMPLE_BYTES} bytes`)
  return buf.toString('utf8')
}

/**
 * The agent's example, or null when its folder has no example.yaml. Throws on an invalid example; the detail page
 * catches that, and src/lib/server/tryItOutExample.test.ts loads every shipped example so it fails in CI instead.
 */
export async function loadTryItOutExample(agentId: string, promptsDir: string = PROMPTS_DIR): Promise<TryItOutExample | null> {
  AgentIdSchema.parse(agentId) // before any path join
  const dir = join(promptsDir, agentId)
  let raw: string
  try {
    raw = await readFile(join(dir, EXAMPLE_FILE), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const where = `${agentId}/${EXAMPLE_FILE}`
  let doc: unknown
  try {
    doc = parseYaml(raw)
  } catch (err) {
    throw new Error(`invalid ${where}: ${(err as Error).message}`)
  }
  const parsed = ExampleSchema.safeParse(doc)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(`invalid ${where}: ${issues.join('; ')}`)
  }
  const e = parsed.data
  const labels = { task: e.task_label, file: e.file_label, hint: e.hint, placeholder: e.task_placeholder }
  return {
    task: e.task,
    file: e.file ? { name: e.file, text: await readCapped(dir, e.file) } : null,
    result: e.result ? { label: e.result_label!, text: await readCapped(dir, e.result) } : null,
    ...(e.task_label || e.file_label || e.hint || e.task_placeholder ? { labels: Object.fromEntries(Object.entries(labels).filter(([, v]) => v)) } : {}),
  }
}
