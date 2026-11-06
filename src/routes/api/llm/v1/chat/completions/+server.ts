import { env } from '$env/dynamic/private'
import { MODEL } from '$lib/server/tryItOutModel.js'
import { handleChatCompletions } from '$lib/server/tryitout/llmProxy.js'
import type { RequestHandler } from './$types'

// Token-authenticated (per-lease bearer) LLM proxy for Pi containers (D-17).
// The real key is read at request time, never at import time.
export const POST: RequestHandler = ({ request }) =>
  handleChatCompletions(request, {
    apiKey: env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY,
    upstreamBaseUrl:
      env.PI_LLM_UPSTREAM_URL ?? process.env.PI_LLM_UPSTREAM_URL ?? 'https://api.openai.com/v1',
    model: MODEL,
    fetchImpl: fetch,
  })
