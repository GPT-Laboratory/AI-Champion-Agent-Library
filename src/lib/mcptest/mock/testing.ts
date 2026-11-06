// Test helper: run a body against a fresh mock and always close it.
import { createMockUpstream } from './upstream'
import type { MockHandle, MockOptions, UpstreamSpecInput } from './spec'

export async function withMock<T>(
  spec: UpstreamSpecInput,
  fn: (mock: MockHandle) => Promise<T>,
  opts: MockOptions = {},
): Promise<T> {
  const mock = await createMockUpstream(spec, opts)
  try {
    return await fn(mock)
  } finally {
    await mock.close()
  }
}
