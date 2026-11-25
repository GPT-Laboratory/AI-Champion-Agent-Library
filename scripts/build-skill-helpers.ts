// Bundles each skill helper CLI (scripts/<helper>.ts and the src/lib code it imports) into one dependency-free
// skill-helpers/<helper>.mjs that runs with plain `node` (>= 18), for the skill download (docs/skill-download.md).
// Runs in `npm run build`, `npm run dev` and the image build, where esbuild (a dev dependency) is still installed;
// the runtime serves the files from SKILL_HELPERS_DIR. No network.
// Usage: npx tsx scripts/build-skill-helpers.ts [outDir]
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isMainModule } from './is-main.js'
import { helperNames } from '../src/lib/skillHelpers.js'

export const DEFAULT_OUT = 'skill-helpers'

export async function buildSkillHelpers(outDir: string = DEFAULT_OUT, root: string = process.cwd()): Promise<string[]> {
  mkdirSync(outDir, { recursive: true })
  const built: string[] = []
  for (const h of helperNames()) {
    const outfile = join(outDir, `${h}.mjs`)
    await build({
      entryPoints: [resolve(root, 'scripts', `${h}.ts`)],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node18',
      legalComments: 'none',
      logLevel: 'error',
      banner: {
        js: `// ${h}: deterministic helper of the AIC Agent Library (AI Champion project), bundled from scripts/${h}.ts. How to run it: README.md of the skill download.`,
      },
    })
    built.push(outfile)
  }
  return built
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const out = process.argv[2] ?? DEFAULT_OUT
  buildSkillHelpers(out)
    .then((files) => console.log(`skill helpers: ${files.length} bundled into ${out}/`))
    .catch((e) => {
      console.error(`error: ${(e as Error).message}`)
      process.exit(1)
    })
}
