import { json } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, agents } from '$lib/server/db.js'
import { runTryOut } from '$lib/server/try-out.js'
import { validateInputValues } from '$lib/server/try-out-inputs.js'
import type { AgentInputField } from '$lib/spec/index.js'
import { agentKindsEnabled } from '$lib/flags.js'
import type { RequestHandler } from './$types'

const inputValueSchema = z.union([
  z.string().max(20_000),
  z.number().finite(),
  z.null(),
])

const tryOutRequestSchema = z.object({
  agentSlug: z.string().trim().min(1).max(200),
  inputValues: z.record(z.string(), inputValueSchema).refine(
    values => Object.keys(values).length <= 100,
    'Too many input fields',
  ),
  additionalInstructions: z.string().max(20_000),
  customization: z.object({
    systemPrompt: z.string().trim().min(1).max(20_000),
    llmName: z.string().trim().min(1).max(200),
    temperature: z.number().min(0).max(2).nullable(),
    toolNames: z.array(z.string().trim().min(1).max(200)).max(50),
  }),
})

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ message: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const parsed = tryOutRequestSchema.safeParse(body)
  if (!parsed.success) {
    return json({ message: 'Try out fields are missing or invalid.' }, { status: 400 })
  }

  const row = db
    .select({ slug: agents.slug, title: agents.title, inputSchema: agents.inputSchema })
    .from(agents)
    .where(eq(agents.slug, parsed.data.agentSlug))
    .get()

  if (!row) {
    return json({ message: 'Agent not found.' }, { status: 404 })
  }

  // WR-09 (flag AGENT_KINDS): the backend, not only the UI, refuses to run a non-agent kind.
  if (agentKindsEnabled()) {
    const { isNonAgentKind } = await import('$lib/server/kinds.js')
    if (isNonAgentKind(db as never, row.slug)) {
      return json({ message: 'Try out is not available for this kind of submission.' }, { status: 403 })
    }
  }

  let inputFields: AgentInputField[]
  try {
    inputFields = JSON.parse(row.inputSchema) as AgentInputField[]
  } catch {
    console.error(`Invalid input schema stored for agent ${row.slug}`)
    return json({ message: 'The agent input schema is invalid.' }, { status: 500 })
  }

  const validatedInputs = validateInputValues(inputFields, parsed.data.inputValues)
  if ('message' in validatedInputs) {
    return json({ message: validatedInputs.message }, { status: 400 })
  }

  try {
    const session = await runTryOut(
      { slug: row.slug, title: row.title, inputFields },
      { ...parsed.data, inputValues: validatedInputs.values },
    )
    return json(session, { status: 201 })
  } catch (err) {
    console.error('Try out processing failed', err)
    return json({ message: 'The try out session could not be processed.' }, { status: 500 })
  }
}
