// GET /agents/:slug/skill.zip — the agent's skill as a download (docs/skill-download.md): SKILL.md, the examples, the
// deterministic helper as one file (agents with one) and a README with what to run before and after the skill.
import { error } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'
import type { RequestHandler } from './$types'
import { db, agents } from '$lib/server/db.js'
import { skillBundle } from '$lib/server/skillBundle'

export const GET: RequestHandler = async ({ params }) => {
  let title = params.slug
  try {
    title = db.select({ title: agents.title }).from(agents).where(eq(agents.slug, params.slug)).get()?.title ?? params.slug
  } catch {
    // No catalog table yet: the slug stands in for the title.
  }
  const zip = await skillBundle(params.slug, title)
  if (!zip) error(404, `no skill for agent: ${params.slug}`)
  return new Response(zip.bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/zip',
      // The name is built from a slug that skillBundle has already validated (AgentIdSchema).
      'Content-Disposition': `attachment; filename="${zip.name}"`,
    },
  })
}
