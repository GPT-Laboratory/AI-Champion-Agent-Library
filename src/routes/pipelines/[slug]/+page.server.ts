// The pipeline page (docs/pipelines.md): the definition and the agents' examples it starts from. Running happens in the
// browser through the ordinary Try It Out job API, one job per step.
import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { loadPipelinePage, type PipelinePage } from '$lib/server/pipelines'
import { isMissingTableError } from '$lib/dbErrors.js'

export const load: PageServerLoad = async ({ params }) => {
  let pipeline: PipelinePage | null = null
  try {
    pipeline = await loadPipelinePage(params.slug)
  } catch (err) {
    // No tables yet (fresh checkout): no agents, so no pipeline to show.
    if (!isMissingTableError(err)) throw err
  }
  if (!pipeline) error(404, 'Pipeline not found. It may have been removed or the URL is incorrect.')
  return { pipeline }
}
