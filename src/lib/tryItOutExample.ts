// src/lib/tryItOutExample.ts
// Shared (client-safe) shape of an agent's optional Try It Out example. Loaded on the server from
// data/tryitout-prompts/<slug>/example.yaml by src/lib/server/tryItOutExample.ts; rendered by TryItOutPanel.
// Kept out of src/lib/tryItOut.ts, whose types are frozen by docs/job-api-contract.md.

export interface TryItOutExample {
  /** Default task text; prefilled in the Task field. */
  task: string
  /** Default input file; attached by default, and viewable so visitors see the input format. */
  file: { name: string; text: string } | null
  /** Saved result for the default task and file; shown without a model call. `label` says where it came from. */
  result: { label: string; text: string } | null
}
