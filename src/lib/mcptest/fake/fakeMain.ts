// Entry point that runs the fake MCP server over the real process stdin/stdout (scorer fixture).
// Usage: node --import tsx fakeMain.ts --variant <id>   with ACME_BASE_URL / ACME_BASE_URL_B / ACME_API_KEY set.
// Exits 0 on stdin EOF; crash-on-init exits 1 like a crashed server. stdout carries protocol only.
import { ENV_VARS } from '../mock/contract'
import { FakeError, serveStdio } from './fakeServer'
import { getVariant } from './variants'

function variantFromArgv(argv: string[]): string {
  const i = argv.indexOf('--variant')
  return i >= 0 && argv[i + 1] ? argv[i + 1] : 'good'
}

async function main(): Promise<number> {
  const variant = variantFromArgv(process.argv.slice(2))
  // The only place the process environment is read: it is copied into the explicit option, nothing else leaks in.
  const env: Record<string, string> = {}
  for (const name of Object.values(ENV_VARS)) {
    const v = process.env[name]
    if (v !== undefined) env[name] = v
  }
  try {
    await serveStdio(process.stdin, process.stdout, { variant, env, endOutputOnEof: false })
  } catch (e) {
    if (e instanceof FakeError) {
      process.stderr.write(`${e.message}\n`)
      return 2
    }
    throw e
  }
  return getVariant(variant)?.behaviour.processFault === 'crash-on-init' ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  () => process.exit(1)
)
