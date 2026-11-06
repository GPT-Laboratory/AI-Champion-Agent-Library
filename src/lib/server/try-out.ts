import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TryOutRequest, TryOutSessionFile } from '$lib/try-out.js'
import type { AgentInputField } from '$lib/spec/index.js'

interface TryOutAgent {
  slug: string
  title: string
  inputFields: AgentInputField[]
}

interface TryOutServiceOptions {
  storagePath: string
  templatePath: string
}

const PLACEHOLDER_OUTPUT =
  'Placeholder processing completed. The customized prompt was queued and saved on the server; no agent container or language model was started.'

function renderTemplate(template: string, agent: TryOutAgent, request: TryOutRequest): string {
  const inputs = agent.inputFields
    .map(field => {
      const value = request.inputValues[field.key]
      const displayValue = value === null || value === '' ? '(not provided)' : String(value)
      const unit = field.unit && value !== null && value !== '' ? ` ${field.unit}` : ''
      return `- ${field.label}: ${displayValue}${unit}`
    })
    .join('\n')
  const replacements: Record<string, string> = {
    '{{agentTitle}}': agent.title,
    '{{agentSlug}}': agent.slug,
    '{{systemPrompt}}': request.customization.systemPrompt,
    '{{llmName}}': request.customization.llmName,
    '{{temperature}}': request.customization.temperature?.toString() ?? 'default',
    '{{tools}}': request.customization.toolNames.join(', ') || 'none',
    '{{inputs}}': inputs,
    '{{additionalInstructions}}': request.additionalInstructions || '(none)',
  }

  return Object.entries(replacements).reduce(
    (rendered, [token, replacement]) => rendered.replaceAll(token, () => replacement),
    template,
  )
}

export function createTryOutService(options: TryOutServiceOptions) {
  let queueTail: Promise<void> = Promise.resolve()

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = queueTail.then(task, task)
    queueTail = result.then(() => undefined, () => undefined)
    return result
  }

  async function run(agent: TryOutAgent, request: TryOutRequest): Promise<TryOutSessionFile> {
    const sessionId = randomUUID()
    const createdAt = new Date().toISOString()

    return enqueue(async () => {
      const template = await readFile(options.templatePath, 'utf8')
      const renderedPrompt = renderTemplate(template, agent, request)
      const completedAt = new Date().toISOString()
      const session: TryOutSessionFile = {
        formatVersion: 2,
        sessionId,
        agent: { slug: agent.slug, title: agent.title },
        customization: request.customization,
        inputValues: request.inputValues,
        additionalInstructions: request.additionalInstructions,
        renderedPrompt,
        output: {
          kind: 'placeholder',
          content: PLACEHOLDER_OUTPUT,
        },
        processingMode: 'placeholder-serial',
        createdAt,
        completedAt,
      }

      await mkdir(options.storagePath, { recursive: true })
      await writeFile(join(options.storagePath, `prompt-${sessionId}.txt`), renderedPrompt, {
        encoding: 'utf8',
        flag: 'wx',
      })
      await writeFile(join(options.storagePath, `session-${sessionId}.json`), JSON.stringify(session, null, 2), {
        encoding: 'utf8',
        flag: 'wx',
      })

      return session
    })
  }

  return { run }
}

const service = createTryOutService({
  storagePath: process.env.TRYOUT_STORAGE_PATH ?? './runtime/try-out-sessions',
  templatePath: process.env.TRYOUT_TEMPLATE_PATH ?? './data/try-out/prompt-template.txt',
})

export const runTryOut = service.run
