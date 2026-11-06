import { describe, expect, it } from 'vitest'
import type { AgentInputField } from '$lib/spec/index.js'
import { validateInputValues } from './try-out-inputs.js'

const fields: AgentInputField[] = [
  {
    key: 'project_name', label: 'Project name', type: 'text', required: true,
    description: null, placeholder: null, unit: null, defaultValue: null,
    options: [], min: null, max: null,
  },
  {
    key: 'floor_count', label: 'Floor count', type: 'number', required: true,
    description: null, placeholder: null, unit: null, defaultValue: null,
    options: [], min: 1, max: 200,
  },
  {
    key: 'urgency', label: 'Urgency', type: 'select', required: false,
    description: null, placeholder: null, unit: null, defaultValue: 'normal',
    options: [{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }],
    min: null, max: null,
  },
]

describe('validateInputValues', () => {
  it('normalizes valid values and trims text', () => {
    expect(validateInputValues(fields, {
      project_name: '  Central Office  ', floor_count: 8, urgency: 'high',
    })).toEqual({ values: {
      project_name: 'Central Office', floor_count: 8, urgency: 'high',
    } })
  })

  it('rejects missing required fields', () => {
    expect(validateInputValues(fields, { floor_count: 8 })).toEqual({
      message: 'Project name is required.',
    })
  })

  it('enforces number limits and select options', () => {
    expect(validateInputValues(fields, {
      project_name: 'Test', floor_count: 0, urgency: 'normal',
    })).toEqual({ message: 'Floor count must be at least 1.' })
    expect(validateInputValues(fields, {
      project_name: 'Test', floor_count: 1, urgency: 'invalid',
    })).toEqual({ message: 'Urgency has an invalid selection.' })
  })

  it('rejects fields not declared by the agent', () => {
    expect(validateInputValues(fields, {
      project_name: 'Test', floor_count: 1, unknown: 'value',
    })).toEqual({ message: 'Try out contains fields that are not defined for this agent.' })
  })
})
