import { describe, it, expect } from 'vitest'
import { buildPiArgs, piInstruction } from './piRunner'
import { parseRunnerConfig } from './runnerConfig'

describe('piInstruction', () => {
  it('names the upload when one was staged', () => {
    expect(piInstruction(true)).toContain('task.txt and upload.txt')
  })

  it('does not mention upload.txt as an input when no file was uploaded', () => {
    const text = piInstruction(false)
    expect(text).toContain('task.txt only')
    expect(text).not.toContain('and upload.txt')
    expect(text).not.toContain('optional')
  })

  it('threads the choice into the pi command line', () => {
    const cfg = parseRunnerConfig({})
    const withFile = buildPiArgs(cfg, 'demo-rfi-triage', true).join(' ')
    const withoutFile = buildPiArgs(cfg, 'demo-rfi-triage', false).join(' ')
    expect(withFile).toContain('task.txt and upload.txt')
    expect(withoutFile).toContain('no file was uploaded')
  })
})
