// src/lib/server/tryitout/piFixtures.ts
// Hand-written `pi --mode json` JSONL streams, built from Pi 1.0.4 docs/json.md.
// These are NOT live captures; they exist to exercise the parser, mapper and
// completion rule in piEvents.test.ts and the runner tests.

function jsonl(records: object[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n'
}

const SESSION = { type: 'session', version: 3, id: 'sess-1', timestamp: '2026-10-08T00:00:00Z', cwd: '/work/job' }

export const PI_SUCCESS_STREAM = jsonl([
  SESSION,
  { type: 'agent_start' },
  { type: 'turn_start' },
  { type: 'message_update', delta: 'Rea' },
  { type: 'message_update', delta: 'ding' },
  { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'read', args: { path: 'input/task.txt' } },
  { type: 'tool_execution_end', toolCallId: 'c1', toolName: 'read', result: { content: [{ type: 'text', text: 'rfi' }] }, isError: false },
  {
    type: 'tool_execution_start',
    toolCallId: 'c2',
    toolName: 'write',
    args: { path: 'output/result.txt', content: 'SECRET_CONTENT' },
  },
  { type: 'tool_execution_end', toolCallId: 'c2', toolName: 'write', result: { content: [{ type: 'text', text: 'ok' }] }, isError: false },
  {
    type: 'message_end',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }], stopReason: 'stop' },
  },
  { type: 'turn_end' },
  { type: 'agent_end', willRetry: false },
  { type: 'agent_settled' },
])

export const PI_MODEL_ERROR_STREAM = jsonl([
  SESSION,
  { type: 'agent_start' },
  {
    type: 'message_end',
    message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: '401 invalid token' },
  },
  { type: 'agent_end', willRetry: false },
  { type: 'agent_settled' },
])

export const PI_RETRY_FAILURE_STREAM = jsonl([
  SESSION,
  { type: 'auto_retry_start', attempt: 1, maxAttempts: 3, errorMessage: '429 rate limited' },
  { type: 'auto_retry_end', success: false, finalError: 'rate limited after 3 attempts' },
  { type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error' } },
  { type: 'agent_end', willRetry: false },
  { type: 'agent_settled' },
])
