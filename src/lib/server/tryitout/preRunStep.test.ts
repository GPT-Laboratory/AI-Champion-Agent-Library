import { describe, expect, it } from 'vitest'
import { PRE_RUN_STEPS, runPreRunStep, type PreRunStep } from './preRunStep'

describe('runPreRunStep', () => {
  it('ifc-ebom-compiler and scope-rule-drafter have a step; other slugs and prototype names pass the input through', () => {
    expect([...PRE_RUN_STEPS.keys()]).toEqual(['ifc-ebom-compiler', 'scope-rule-drafter'])
    for (const slug of ['qto-normalization', 'constructor', '__proto__']) expect(runPreRunStep(slug, 'x')).toEqual({ text: 'x', event: null })
  })

  it('an unreadable input or a throwing step leaves the input unchanged and says so', () => {
    expect(runPreRunStep('ifc-ebom-compiler', 'not an upload')).toEqual({ text: 'not an upload', event: 'tool step: the input could not be read, so it is passed on unchanged' })
    const boom: PreRunStep = () => {
      throw new Error('bug')
    }
    expect(runPreRunStep('x', 'in', new Map([['x', boom]]))).toEqual({ text: 'in', event: 'tool step failed to run; the input is passed on unchanged' })
  })
})
