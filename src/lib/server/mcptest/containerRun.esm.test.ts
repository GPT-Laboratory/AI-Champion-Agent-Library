// E9 defect D1: the staged driver tree needs a package.json with "type":"module", otherwise tsx compiles driver.ts
// as CommonJS and its top-level await fails with ERR_REQUIRE_ASYNC_MODULE. Fake runtime only.
import { describe, expect, it } from 'vitest'
import type { DriverRequest } from '$lib/mcptest/driverRequest'
import { createFakeRuntime } from '../tryitout/runtimeFake'
import { runInContainer } from './containerRun'

const fakeReq: DriverRequest = {
  v: 1,
  subject: { kind: 'fake', variant: 'good' },
  cases: ['T1-STD-CATALOG']
}

describe('staged package.json (D1)', () => {
  it('stages /work/package.json = {"type":"module"} before the driver is exec-ed', async () => {
    const rt = createFakeRuntime()
    let pkg: string | null = null
    rt.scriptExec(async ({ files }) => {
      const f = files.get('/work/package.json')
      pkg = f && f !== 'dir' ? new TextDecoder().decode(f) : null
      return 0
    })
    await runInContainer(rt, fakeReq, [], {
      driverTree: [{ path: 'src/lib/mcptest/driver.ts', content: '// driver' }]
    })
    expect(pkg).not.toBeNull()
    expect(JSON.parse(pkg as unknown as string)).toEqual({ type: 'module' })
  })
})
