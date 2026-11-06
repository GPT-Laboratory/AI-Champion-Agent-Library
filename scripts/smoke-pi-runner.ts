// scripts/smoke-pi-runner.ts
// NOT wired into test/build/dev. Run on a host with Podman:
//   npx tsx scripts/smoke-pi-runner.ts [--fs-mode tmpfs|layer] [--proxy-host aic-agent-library] [--socket PATH]
// Drives the production runtime code (createDockerodeRuntime) against a real engine and
// prints which PI_RUNNER_FS_MODE the host supports.
import { parseRunnerConfig, type RunnerConfig } from '../src/lib/server/tryitout/runnerConfig'
import { createDockerodeRuntime } from '../src/lib/server/tryitout/runtimeDockerode'
import {
  AGENT_DIR,
  WORK_ROOT_IN_CONTAINER,
  LABEL_MANAGED,
  LABEL_INSTANCE,
  TryItOutRuntimeError,
  type ContainerRuntime,
} from '../src/lib/server/tryitout/runtime'

const USAGE =
  'Usage: npx tsx scripts/smoke-pi-runner.ts [--fs-mode tmpfs|layer] [--proxy-host aic-agent-library] [--socket PATH]'

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

let failures = 0
function report(ok: boolean | 'skip', step: string, detail: string) {
  if (ok === 'skip') console.log(`SKIP ${step}: ${detail}`)
  else {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${step}: ${detail}`)
    if (!ok) failures += 1
  }
}

async function run(rt: ContainerRuntime, id: string, cmd: string[], cwd = WORK_ROOT_IN_CONTAINER) {
  let stdout = ''
  let stderr = ''
  const res = await rt.exec(id, {
    cmd,
    workingDir: cwd,
    onStdout: (c) => (stdout += c.toString()),
    onStderr: (c) => (stderr += c.toString()),
  })
  return { exitCode: res.exitCode, stdout, stderr }
}

async function stage(rt: ContainerRuntime, id: string): Promise<boolean> {
  try {
    await rt.putFiles(id, AGENT_DIR, [{ path: 'smoke-agent.txt', content: 'agent' }])
    await rt.putFiles(id, WORK_ROOT_IN_CONTAINER, [
      { path: 'output', type: 'dir' },
      { path: 'output/smoke.txt', content: 'hello' },
    ])
    const a = await run(rt, id, ['test', '-f', `${AGENT_DIR}/smoke-agent.txt`])
    const w = await run(rt, id, ['test', '-f', `${WORK_ROOT_IN_CONTAINER}/output/smoke.txt`])
    return a.exitCode === 0 && w.exitCode === 0
  } catch (err) {
    console.log(`  stage error: ${(err as Error).message}`)
    return false
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return 0
  }
  const requestedMode = argValue(args, '--fs-mode')
  if (requestedMode && requestedMode !== 'tmpfs' && requestedMode !== 'layer') {
    console.error(USAGE)
    return 2
  }
  const proxyHost = argValue(args, '--proxy-host') ?? 'aic-agent-library'
  const socket = argValue(args, '--socket')

  const env: Record<string, string | undefined> = { ...process.env }
  if (socket) env.PI_RUNNER_SOCKET = socket
  const base = parseRunnerConfig(env)

  const baseRt = createDockerodeRuntime(base, 'smoke')
  try {
    await baseRt.ping()
    report(true, 'ping socket', base.socketPath)
  } catch (err) {
    if (err instanceof TryItOutRuntimeError && err.code === 'engine_unavailable') {
      console.error(`engine_unavailable: ${err.message}`)
      return 1
    }
    console.error(`engine_unavailable: ${(err as Error).message}`)
    return 1
  }

  try {
    await baseRt.ensureNetwork()
    report(true, 'ensureNetwork', `${base.network}${base.allowOpenEgress ? ' (open egress allowed)' : ' (internal)'}`)
  } catch (err) {
    report(false, 'ensureNetwork', (err as Error).message)
    return 1
  }

  const modes: Array<'tmpfs' | 'layer'> = requestedMode ? [requestedMode as 'tmpfs' | 'layer'] : ['tmpfs', 'layer']
  let chosen: { mode: 'tmpfs' | 'layer'; rt: ContainerRuntime; id: string } | undefined
  const created: Array<{ rt: ContainerRuntime; id: string }> = []

  try {
    for (const mode of modes) {
      const cfg: RunnerConfig = { ...base, fsMode: mode }
      const rt = createDockerodeRuntime(cfg, 'smoke')
      let id: string
      try {
        id = await rt.createAndStart({
          name: `aic-pi-smoke-${Math.random().toString(36).slice(2, 10)}`,
          labels: { [LABEL_MANAGED]: '1', [LABEL_INSTANCE]: `smoke-${Math.random().toString(36).slice(2, 10)}` },
          env: [],
        })
        created.push({ rt, id })
        report(true, `createAndStart (${mode})`, id.slice(0, 12))
      } catch (err) {
        report(false, `createAndStart (${mode})`, (err as Error).message)
        continue
      }
      const ok = await stage(rt, id)
      report(ok, `putFiles + test -f (${mode})`, ok ? 'files visible in /work and agent dir' : 'staging failed')
      if (ok) {
        chosen = { mode, rt, id }
        break
      }
    }

    if (!chosen) {
      console.log('FAIL no fs mode works: stop and report (needs env-generated config plan)')
      return 1
    }
    const { rt, id } = chosen

    const ver = await run(rt, id, ['pi', '--version'])
    report(ver.exitCode === 0, 'pi --version (offline)', `exit=${ver.exitCode} stdout=${JSON.stringify(ver.stdout.trim())} stderr=${JSON.stringify(ver.stderr.trim().slice(0, 200))}`)

    const split = await run(rt, id, ['sh', '-c', 'echo out; echo err 1>&2; exit 7'])
    report(
      split.exitCode === 7 && split.stdout.trim() === 'out' && split.stderr.trim() === 'err',
      'exec demux + exit code',
      `exit=${split.exitCode} stdout=${JSON.stringify(split.stdout.trim())} stderr=${JSON.stringify(split.stderr.trim())}`,
    )

    const dns = await run(rt, id, ['getent', 'hosts', proxyHost])
    if (dns.exitCode === 0) report(true, `dns ${proxyHost}`, dns.stdout.trim())
    else report('skip', `dns ${proxyHost}`, 'not resolvable; start the app container (podman-compose up -d) and pass --proxy-host')

    const egress = await run(rt, id, ['node', '-e', "fetch('https://example.com').then(()=>process.exit(0),()=>process.exit(3))"])
    if (base.allowOpenEgress) report('skip', 'external egress blocked', 'PI_RUNNER_ALLOW_OPEN_EGRESS=true')
    else report(egress.exitCode !== 0, 'external egress blocked', `exit=${egress.exitCode}`)

    const t0 = Date.now()
    const killed = await run(rt, id, ['timeout', '--signal=KILL', '2', 'sleep', '10'])
    const elapsed = Date.now() - t0
    report(killed.exitCode === 137 && elapsed < 5000, 'timeout kill', `exit=${killed.exitCode} in ${elapsed}ms`)

    const files = await rt.getFiles(id, `${WORK_ROOT_IN_CONTAINER}/output`, { maxBytes: 1_000_000, maxFiles: 10 })
    const got = files['smoke.txt'] ? Buffer.from(files['smoke.txt']).toString() : undefined
    report(got === 'hello', 'getFiles round trip', `files=${Object.keys(files).join(',')}`)

    console.log(`RECOMMENDED PI_RUNNER_FS_MODE=${chosen.mode}`)
  } finally {
    for (const c of created) await c.rt.remove(c.id).catch(() => {})
  }

  const left = (await baseRt.listManaged()).filter((c) => (c.labels[LABEL_INSTANCE] ?? '').startsWith('smoke-'))
  report(left.length === 0, 'cleanup', `${left.length} smoke containers left`)
  return failures === 0 ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`FAIL unexpected: ${(err as Error).message}`)
    process.exit(1)
  },
)
