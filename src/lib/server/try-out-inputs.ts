import type { AgentInputField } from '$lib/spec/index.js'

export function validateInputValues(
  fields: AgentInputField[],
  values: Record<string, string | number | null>,
): { values: Record<string, string | number | null> } | { message: string } {
  const allowedKeys = new Set(fields.map(field => field.key))
  if (Object.keys(values).some(key => !allowedKeys.has(key))) {
    return { message: 'Try out contains fields that are not defined for this agent.' }
  }

  const normalized: Record<string, string | number | null> = {}
  for (const field of fields) {
    const value = values[field.key] ?? null
    const isEmpty = value === null || (typeof value === 'string' && value.trim() === '')
    if (field.required && isEmpty) {
      return { message: `${field.label} is required.` }
    }

    if (isEmpty) {
      normalized[field.key] = null
      continue
    }

    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { message: `${field.label} must be a number.` }
      }
      if (field.min !== null && value < field.min) {
        return { message: `${field.label} must be at least ${field.min}.` }
      }
      if (field.max !== null && value > field.max) {
        return { message: `${field.label} must be at most ${field.max}.` }
      }
      normalized[field.key] = value
      continue
    }

    if (typeof value !== 'string') {
      return { message: `${field.label} must be text.` }
    }
    const trimmed = value.trim()
    if (field.type === 'select' && !field.options.some(option => option.value === trimmed)) {
      return { message: `${field.label} has an invalid selection.` }
    }
    normalized[field.key] = trimmed
  }

  return { values: normalized }
}
