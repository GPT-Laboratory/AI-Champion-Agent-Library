# Job API Contract — Try It Out (build spec)

Build-time reference for the runnable "Try it out" flow (Phase 6). This is the
interface the AIC library UI is implemented against. It is currently backed by a
mock. The mock's data shapes MUST match the types below so that swapping to the
real backend later touches only `src/lib/tryItOut.ts` and no UI code.

Audience: the implementing agent. Not a proposal; assumptions are stated as
provisional decisions so planning is never blocked. Items in "Provisional
assumptions" are the only things expected to change.

## Scope

Show-and-Tell. One runnable agent working end to end. No auth beyond a shared-token
placeholder. Concurrency limited to per-job working directory isolation; no pool
guarantees required.

## Client API (must exist exactly as specified)

Three functions in `src/lib/tryItOut.ts`. UI components import ONLY these. Nothing
in the UI references endpoints, `fetch`, `EventSource`, or event transport directly.

```ts
submitJob(agentId: string, task: string, file?: File | null): Promise<SubmitResult>
subscribeProgress(jobId: string, onUpdate: (u: JobUpdate) => void): () => void  // returns unsubscribe
downloadArtifact(jobId: string): Promise<void>
```

Swapping mock → real replaces only the bodies of these three. Signatures are frozen.

## Types

```ts
type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

interface JobEvent {
  ts: string;                                   // "10:46:48"
  type: 'tool_start' | 'tool_end' | 'info';
  tool?: string;                                // "read" | "write" | "grep"
  summary: string;                              // the line the feed renders
}

interface JobUpdate {
  status: JobStatus;
  events: JobEvent[];
  error: string | null;
}

interface SubmitResult {
  jobId: string;
  status: JobStatus;
}
```

The UI renders `JobEvent.summary` and nothing else from an event; richer fields are
allowed but not required.

## Real backend endpoints (target the mock emulates)

- `POST /jobs` — multipart `agentId`, `task`, optional `file` → `{ jobId, status: 'queued' }`
- Progress, one of:
  - poll: `GET /jobs/:id` → `JobUpdate`
  - stream: `GET /jobs/:id/events` (SSE) emitting `JobEvent` objects
  `subscribeProgress` abstracts which is used. (Provisional: poll.)
- `GET /jobs/:id/artifact` — zipped output files, valid only when `status === 'succeeded'`, `Content-Disposition: attachment`

## Mock behavior (implement now)

- `submitJob`: ~400 ms delay, return a mock `jobId`, status `queued`.
- `subscribeProgress`: emit `running` immediately, then timestamped events on a
  timer, terminal `succeeded` at ~4 s. Event summaries modeled on real observed pi
  `tool_execution` output:
  - `read data/sample.csv`
  - `read data/sample.csv (12 lines)`
  - `count rows in data/sample.csv`
  - `write output/result.txt`
- Fail path: when `task` matches `/(^|\W)fail(\W|$)/i`, end in `failed` with a
  realistic `error` (e.g. `pi exited non-zero: required input file missing`).
- `downloadArtifact`: generate a small text blob referencing the task.

Mock internals must be isolated so they can be deleted wholesale when the real
backend lands.

## Completion semantics

`succeeded` corresponds to pi `agent_settled` plus a clean exit. `failed` is a
non-zero exit, timeout, or error, always with an `error` string. Do NOT key success
off `agent_end` (it can fire mid-retry).

## Provisional assumptions (encoded in the mock; confirm with runtime owner)

- Progress transport: poll.
- Auth between UI backend and job service: none / shared-token placeholder.
- Job isolation: each job runs in its own working directory.
- Artifact: a zip of the agent's `output/` directory.
