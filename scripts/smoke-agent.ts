// Live smoke test with an LLM judge for any agent that has a smoke profile (scripts/smoke/profiles.ts): one real Try It
// Out run on the agent's example, then gate 1 (deterministic: the agent's helper and the answer key) and gate 2 (the
// judge on the free text). Procedure, costs and exit codes: docs/tryitout-live-run.md, section 6.
//
// Usage (a running app for a run; OPENAI_API_KEY, and OPENAI_BASE_URL for Azure, for the judge):
//   npx tsx --env-file=.env scripts/smoke-agent.ts --agent <slug> [--case clean|injection|...] [--result <file>]
//       [--base-url http://127.0.0.1:3000] [--judge-model <model>] [--judge-temperature <n|none>] [--no-judge]
//       [--ledger <path>] [--out-dir <dir>]
//   npx tsx --env-file=.env scripts/smoke-agent.ts --agent <slug> --calibrate [--judge-model <model>]
//   npx tsx scripts/smoke-agent.ts --list
// Exit codes: 0 all checks pass, 1 a check failed, 2 usage error or no key, 3 budget refusal, 5 run or API error.
import { isMainModule } from './is-main.js'
import { USAGE_OPTIONS, UsageError, parseSmokeArgs, runSmoke, type SmokeDeps, type SmokeOpts, type SmokeProfile } from './smoke/core.js'
import { PROFILES } from './smoke/profiles.js'

export interface AgentArgs {
  profile: SmokeProfile
  opts: SmokeOpts
}

/** Splits off --agent and resolves the profile; the remaining arguments are the engine's. */
export function parseAgentArgs(argv: string[], profiles: ReadonlyMap<string, SmokeProfile> = PROFILES): AgentArgs {
  const i = argv.indexOf('--agent')
  const slug = i >= 0 ? argv[i + 1] : undefined
  if (!slug || slug.startsWith('--')) throw new UsageError(`--agent <slug> is required; one of: ${[...profiles.keys()].join(', ')}`)
  const profile = profiles.get(slug)
  if (!profile) throw new UsageError(`no smoke profile for ${slug}; one of: ${[...profiles.keys()].join(', ')}`)
  return { profile, opts: parseSmokeArgs([...argv.slice(0, i), ...argv.slice(i + 2)], profile.caseKinds) }
}

export async function main(argv: string[], deps: SmokeDeps = {}): Promise<number> {
  const out = deps.out ?? ((s: string) => process.stdout.write(s + '\n'))
  if (argv.includes('--list')) {
    for (const p of PROFILES.values()) out(`${p.slug}  cases: ${p.caseKinds.join(', ')}  criteria: ${p.rubric.map((r) => r.id).join(', ')}`)
    return 0
  }
  let a: AgentArgs
  try {
    a = parseAgentArgs(argv)
  } catch (e) {
    if (!(e instanceof UsageError)) throw e
    out(`${e.message}\nusage: smoke-agent.ts --agent <slug> [--case <kind>] ${USAGE_OPTIONS} | --list`)
    return 2
  }
  return runSmoke(a.profile, a.opts, { ...deps, out })
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`error: ${(e as Error).message}`)
      process.exit(5)
    },
  )
}
