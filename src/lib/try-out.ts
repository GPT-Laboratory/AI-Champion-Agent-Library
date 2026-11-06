export interface TryOutCustomization {
  systemPrompt: string
  llmName: string
  temperature: number | null
  toolNames: string[]
}

export interface TryOutRequest {
  agentSlug: string
  inputValues: Record<string, string | number | null>
  additionalInstructions: string
  customization: TryOutCustomization
}

export interface TryOutSessionFile {
  formatVersion: 2
  sessionId: string
  agent: {
    slug: string
    title: string
  }
  customization: TryOutCustomization
  inputValues: Record<string, string | number | null>
  additionalInstructions: string
  renderedPrompt: string
  output: {
    kind: 'placeholder'
    content: string
  }
  processingMode: 'placeholder-serial'
  createdAt: string
  completedAt: string
}

export function isTryOutSessionFile(value: unknown): value is TryOutSessionFile {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Partial<TryOutSessionFile>
  return candidate.formatVersion === 2
    && typeof candidate.sessionId === 'string'
    && typeof candidate.agent?.slug === 'string'
    && typeof candidate.customization?.systemPrompt === 'string'
    && typeof candidate.customization?.llmName === 'string'
    && Array.isArray(candidate.customization?.toolNames)
    && !!candidate.inputValues
    && typeof candidate.inputValues === 'object'
    && typeof candidate.additionalInstructions === 'string'
    && typeof candidate.output?.content === 'string'
}
