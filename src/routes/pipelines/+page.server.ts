// The list of agent pipelines (docs/pipelines.md): every data/pipelines/<slug>/pipeline.yaml, with its steps.
import type { PageServerLoad } from './$types'
import { listPipelineCards, type PipelineCard } from '$lib/server/pipelines'
import { isMissingTableError } from '$lib/dbErrors.js'

export const load: PageServerLoad = async () => {
  let pipelines: PipelineCard[] = []
  try {
    pipelines = await listPipelineCards()
  } catch (err) {
    // No tables yet (fresh checkout): no agents, so no pipeline to list.
    if (!isMissingTableError(err)) throw err
  }
  return { pipelines }
}
