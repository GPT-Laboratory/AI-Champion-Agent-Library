// src/lib/tryItOutCheck.ts
// Shared (client-safe) shape of the tool check of a Try It Out job (docs/tryitout-post-run-check.md). Set on the
// server by the post-run check; served by GET /api/tryitout/jobs/:id/check and shown as a badge by TryItOutPanel.
// Kept out of src/lib/tryItOut.ts, whose types are frozen by docs/job-api-contract.md. The badge reads this, never a
// file of the artifact, because the agent can write any file name into its output.

export type CheckStatus = 'match' | 'differences' | 'not-checked'

export interface JobCheck {
  status: CheckStatus
  /** One line, as in the progress feed (e.g. "the class rows match the ebom-join helper on every cell"). */
  summary: string
  /** The report file in the artifact, or null when it could not be added. */
  file: string | null
}
