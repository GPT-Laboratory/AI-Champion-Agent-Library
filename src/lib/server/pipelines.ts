// src/lib/server/pipelines.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// Pipelines (docs/pipelines.md): data/pipelines/<slug>/pipeline.yaml names the agents in order and the data files of
// the tool hand-overs; each step's task and the starting input are the agents' own Try It Out examples. The page
// /pipelines/<slug> runs the steps as ordinary Try It Out jobs, one after the other, so the job API is unchanged.
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { inArray } from 'drizzle-orm'
import { db, agents } from './db.js'
import { loadTryItOutExample } from './tryItOutExample'

export const PIPELINES_DIR = process.env.PIPELINES_DIR ?? join(process.cwd(), 'data', 'pipelines')
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FileName = z.string().max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)

const PipelineSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(1000),
    steps: z.array(z.string().regex(SLUG)).length(3),
    mapping: FileName,
    catalog: FileName,
  })
  .strict()

export type PipelineDef = z.infer<typeof PipelineSchema> & { slug: string }

/** The pipeline's definition, or null when there is no such pipeline. Throws on an invalid pipeline.yaml. */
export async function loadPipelineDef(slug: string, dir: string = PIPELINES_DIR): Promise<PipelineDef | null> {
  if (!SLUG.test(slug)) return null // before any path join
  let raw: string
  try {
    raw = await readFile(join(dir, slug, 'pipeline.yaml'), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const parsed = PipelineSchema.safeParse(parseYaml(raw))
  if (!parsed.success) throw new Error(`invalid pipelines/${slug}/pipeline.yaml: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  return { slug, ...parsed.data }
}

/** Every pipeline, in folder order. */
export async function listPipelines(dir: string = PIPELINES_DIR): Promise<PipelineDef[]> {
  let names: string[]
  try {
    names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  } catch {
    return []
  }
  const out: PipelineDef[] = []
  for (const n of names) {
    const p = await loadPipelineDef(n, dir)
    if (p) out.push(p)
  }
  return out
}

/** The pipelines an agent is a step of (for the link on its page): slug, title and the step number. */
export async function pipelinesOf(agentSlug: string, dir: string = PIPELINES_DIR): Promise<{ slug: string; title: string; step: number }[]> {
  try {
    return (await listPipelines(dir)).flatMap((p) => {
      const i = p.steps.indexOf(agentSlug)
      return i < 0 ? [] : [{ slug: p.slug, title: p.title, step: i + 1 }]
    })
  } catch {
    return [] // a broken pipeline never breaks an agent page
  }
}

export interface PipelineCard {
  slug: string
  title: string
  summary: string
  steps: { slug: string; title: string }[]
}

/** Every pipeline for the list page /pipelines, with its steps' agent titles. A broken pipeline is left out. */
export async function listPipelineCards(dir: string = PIPELINES_DIR): Promise<PipelineCard[]> {
  let defs: PipelineDef[]
  try {
    defs = await listPipelines(dir)
  } catch (err) {
    console.warn('Pipelines not listed:', (err as Error).message)
    return []
  }
  const slugs = [...new Set(defs.flatMap((d) => d.steps))]
  const titles = new Map(
    slugs.length ? db.select({ slug: agents.slug, title: agents.title }).from(agents).where(inArray(agents.slug, slugs)).all().map((r) => [r.slug, r.title]) : [],
  )
  return defs.map((d) => ({ slug: d.slug, title: d.title, summary: d.summary, steps: d.steps.map((s) => ({ slug: s, title: titles.get(s) ?? s })) }))
}

export interface PipelineStep {
  slug: string
  title: string
  /** The agent's example task (for the first step: the example scope notes). */
  task: string
  /** False when the agent is not runnable in Try It Out here (then the pipeline cannot run). */
  runnable: boolean
}

export interface PipelinePage {
  slug: string
  title: string
  summary: string
  steps: PipelineStep[]
  /** The first step's example file: the E-BOM data the notes apply to. */
  data: { name: string; text: string }
  mapping: string
  catalog: string
}

/** Everything the pipeline page needs, or null when there is no such pipeline. */
export async function loadPipelinePage(slug: string, dir: string = PIPELINES_DIR): Promise<PipelinePage | null> {
  const def = await loadPipelineDef(slug, dir)
  if (!def) return null
  const rows = db
    .select({ slug: agents.slug, title: agents.title, mode: agents.tryItOutMode })
    .from(agents)
    .where(inArray(agents.slug, def.steps))
    .all()
  const bySlug = new Map(rows.map((r) => [r.slug, r]))
  const examples = await Promise.all(def.steps.map((s) => loadTryItOutExample(s)))
  const first = examples[0]
  if (!first?.file) throw new Error(`pipelines/${slug}: the first step (${def.steps[0]}) needs an example file (the E-BOM data)`)
  return {
    slug,
    title: def.title,
    summary: def.summary,
    steps: def.steps.map((s, i) => ({
      slug: s,
      title: bySlug.get(s)?.title ?? s,
      task: examples[i]?.task ?? '',
      runnable: bySlug.get(s)?.mode === 'runnable',
    })),
    data: first.file,
    mapping: await readFile(join(dir, slug, def.mapping), 'utf8'),
    catalog: await readFile(join(dir, slug, def.catalog), 'utf8'),
  }
}
