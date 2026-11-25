// src/lib/server/tryitout/preRunStep.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// Optional per-agent tool step that runs BEFORE a Try It Out job, on the container path and the direct-model fallback
// alike (docs/tryitout-post-run-check.md, "Tool step before the run"). It rewrites the agent's input with deterministic
// own code (no model call), so the model copies a tool's answer instead of working it out: for ifc-ebom-compiler the
// scope exclusions. A step that cannot read the input, or throws, leaves the input unchanged and never fails the job.

import { prepareEbomUpload, type PreparedUpload } from '$lib/ebom/prepare'
import { prepareRuleUpload } from '$lib/rules/ruleCheck'
import { pushEvent } from '../tryItOutJobs'
import { logDetail } from './redact'

export type PreRunStep = (input: string) => PreparedUpload | null

/** slug -> step. A Map, so a slug such as "constructor" never reaches an Object prototype member. */
export const PRE_RUN_STEPS: ReadonlyMap<string, PreRunStep> = new Map<string, PreRunStep>([
  ['ifc-ebom-compiler', prepareEbomUpload],
  ['scope-rule-drafter', prepareRuleUpload],
])

/** The input as the agent gets it, plus one feed line; the input unchanged when the agent has no step. Never throws. */
export function runPreRunStep(slug: string, input: string, steps: ReadonlyMap<string, PreRunStep> = PRE_RUN_STEPS): { text: string; event: string | null } {
  const step = steps.get(slug)
  if (!step) return { text: input, event: null }
  try {
    const r = step(input)
    if (!r) return { text: input, event: 'tool step: the input could not be read, so it is passed on unchanged' }
    return { text: r.text, event: r.note }
  } catch (err) {
    logDetail(`pre-run step for ${slug} failed:`, err)
    return { text: input, event: 'tool step failed to run; the input is passed on unchanged' }
  }
}

/** runPreRunStep plus its feed line for the job. */
export function applyPreRunStep(jobId: string, slug: string, input: string): string {
  const r = runPreRunStep(slug, input)
  if (r.event) pushEvent(jobId, r.event)
  return r.text
}
