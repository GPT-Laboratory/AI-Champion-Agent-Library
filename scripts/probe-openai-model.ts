// scripts/probe-openai-model.ts
// Standalone reproducible probe (NOT wired into test/build/dev) that answers
// RESEARCH.md Open Questions §1: which model ID the deployed OPENAI_API_KEY
// can actually reach, and whether that model accepts a custom `temperature`.
// Run with: npx tsx --env-file=.env scripts/probe-openai-model.ts
import OpenAI from 'openai'
import { isMainModule } from './is-main.js'

// Priority order per the plan's Task 2 spec: cheap/known-good candidates first,
// falling back to the current flagship gpt-5(.x)-* family (excluding -pro variants).
const PRIORITY_CANDIDATES = ['gpt-4.1-mini', 'gpt-4.1', 'gpt-5-chat-latest'] as const
const FALLBACK_FAMILY_RE = /^gpt-5(\.\d+)?-/
const FALLBACK_EXCLUDE_RE = /-pro/

async function main() {
  const client = new OpenAI() // reads process.env.OPENAI_API_KEY by default (D-09)

  let modelIds: string[]
  try {
    const list = await client.models.list()
    modelIds = list.data.map(m => m.id).sort()
  } catch (err) {
    console.error('models.list() FAILED — the deployed key could not be verified:')
    console.error((err as Error).message)
    console.error('STOP: do not fabricate a model choice. Revisit Task 1 (OPENAI_API_KEY).')
    process.exit(1)
  }

  console.log('## models.list() candidate presence')
  const idSet = new Set(modelIds)
  for (const candidate of PRIORITY_CANDIDATES) {
    console.log(`${candidate}: ${idSet.has(candidate) ? 'present' : 'absent'}`)
  }
  const fallbackCandidates = modelIds.filter(
    id => FALLBACK_FAMILY_RE.test(id) && !FALLBACK_EXCLUDE_RE.test(id)
  )
  console.log(
    `gpt-5(.x)-* fallback family (non -pro): ${
      fallbackCandidates.length > 0 ? fallbackCandidates.join(', ') : 'none found'
    }`
  )

  let chosen: string | undefined
  for (const candidate of PRIORITY_CANDIDATES) {
    if (idSet.has(candidate)) {
      chosen = candidate
      break
    }
  }
  if (!chosen && fallbackCandidates.length > 0) {
    chosen = fallbackCandidates[0]
  }

  if (!chosen) {
    console.error('STOP: no priority candidate and no gpt-5(.x)-* fallback found in models.list().')
    console.error(`Full model id list: ${modelIds.join(', ')}`)
    process.exit(1)
  }

  console.log(`\nchosen candidate: ${chosen}`)

  console.log('\n## temperature probe result')
  let temperatureSupported: boolean
  try {
    await client.responses.create({
      model: chosen,
      temperature: 0.2,
      input: 'ping',
      max_output_tokens: 16,
    })
    console.log('TEMPERATURE_ACCEPTED')
    temperatureSupported = true
  } catch (err) {
    const message = (err as Error).message ?? String(err)
    const mentionsTemperature = /temperature/i.test(message)
    const status = (err as { status?: number }).status
    if (mentionsTemperature || status === 400) {
      console.log('TEMPERATURE_REJECTED')
      console.log(`verbatim error: ${message}`)
      try {
        await client.responses.create({
          model: chosen,
          input: 'ping',
          max_output_tokens: 16,
        })
        console.log('(retry without temperature succeeded)')
      } catch (retryErr) {
        console.log(`(retry without temperature also failed: ${(retryErr as Error).message})`)
      }
      temperatureSupported = false
    } else {
      console.error('Unexpected non-temperature error during probe call:')
      console.error(message)
      process.exit(1)
    }
  }

  console.log('\n## Decision')
  console.log(`CHOSEN_MODEL=${chosen}`)
  console.log(`TEMPERATURE_SUPPORTED=${temperatureSupported}`)
}

const isMain = isMainModule(import.meta.url, process.argv[1])
if (isMain) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
