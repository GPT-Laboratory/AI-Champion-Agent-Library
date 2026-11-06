# Dependency health

Snapshot taken 2026-10-13 on branch `autonomous/overnight-improvements` (npm 10.9.9, Node 22.23). Source: `npm audit`, `npm outdated`, read-only registry queries. Decisions: D-253..D-257 in `.planning/AUTONOMOUS-DECISIONS.md`.

## Result

| | Before | After |
|---|---|---|
| `npm audit` total | 18 (1 low, 8 moderate, 9 high) | 9 (3 low, 6 moderate, 0 high) |

All 9 high findings are gone. What was applied: in-range minor/patch bumps (no major version, no new dependency, `package.json` ranges raised to the installed versions). `npm run check` exits 0 (208 files, 2087 tests passed, tsc clean) after the bump.

Applied bumps (all within the existing caret range):

| Package | From | To | Type |
|---|---|---|---|
| @sveltejs/kit | 2.55.0 | 2.70.3 | runtime |
| @sveltejs/adapter-node | 5.5.4 | 5.5.7 | dev (build) |
| @sveltejs/vite-plugin-svelte | 7.0.0 | 7.3.1 | dev |
| svelte | 5.54.0 | 5.57.2 | runtime |
| drizzle-orm | 0.45.1 | 0.45.4 | runtime |
| yaml | 2.8.2 | 2.9.1 | runtime |
| zod | 4.3.6 | 4.6.7 | runtime |
| openai | 7.5.0 | 7.32.0 | runtime |
| better-sqlite3 | 12.8.0 | 12.11.1 | runtime (native) |
| vite | 8.0.1 | 8.3.4 | dev |
| tailwindcss, @tailwindcss/vite | 4.2.2 | 4.3.3 | dev |
| tsx | 4.21.0 | 4.23.15 | dev (also used by `npm run ingest` etc.) |
| drizzle-kit | 0.31.10 | 0.31.11 | dev |
| jsdom | 29.0.0 | 29.1.1 | dev |
| @testing-library/svelte | 5.3.1 | 5.4.2 | dev |
| @types/node, @types/dockerode | 25.5.0, 4.0.1 | 25.9.9, 4.0.2 | dev |

Because `Containerfile.mcp-test-runner` pins `yaml`, `zod`, `fflate` and `tsx` to the exact versions in `package.json` (a test, `src/lib/mcptest/containerfile.test.ts`, compares them), its pins were updated to `yaml@2.9.1 zod@4.6.7 fflate@0.8.3 tsx@4.23.15`. That image is still unbuilt (pending human), so rebuild it when it is first built.

## Remaining findings (9)

| Package | Severity | Direct? | Runtime or dev | Why it remains | Recommended action |
|---|---|---|---|---|---|
| vitest, @vitest/mocker | moderate | direct (dev) | dev only | Fix is in range (4.1.11) but `npm install vitest@4.1.11` and `npm update` crash with an npm 10.9.9 arborist bug (`Cannot read properties of null (reading 'edgesOut')` in `#loadPeerSet`). Vitest 4.1.0 is installed. | Try with a newer npm (11.x) or `npm install vitest@4.1.11 --legacy-peer-deps`; then `npm run check`. Path-traversal in the vitest dev server only; tests do not expose it. |
| drizzle-kit, @esbuild-kit/core-utils, @esbuild-kit/esm-loader, esbuild (<=0.24.2) | moderate | drizzle-kit direct (dev) | dev only (not shipped: image runs `npm prune --omit=dev`) | `npm audit` proposes drizzle-kit 0.18.1, a downgrade flagged as a major change. The esbuild issue is the dev-server request exposure, which does not apply to a CLI schema push. | Wait for a drizzle-kit release that drops `@esbuild-kit`. Do not run `npm audit fix --force`. |
| @sveltejs/kit, @sveltejs/adapter-node, cookie (<0.7.0) | low | direct (runtime) | runtime | The fix is SvelteKit 3.0 (major). `cookie` accepts out-of-bounds cookie name/path/domain characters; the app sets only its own fixed cookie name. | Plan a SvelteKit 3 migration as its own task; not now. |

## Outdated, deliberately not bumped (major versions)

| Package | Current | Latest | Note |
|---|---|---|---|
| @sveltejs/kit / adapter-node | 2.70.3 / 5.5.7 | 3.0.1 / 6.0.0 | major; also clears the low `cookie` finding |
| better-sqlite3 | 12.11.1 | 13.0.3 | major, native module; test on the target Node and in the image build |
| jsdom | 29.1.1 | 30.1.2 | major, dev |
| @testing-library/jest-dom | 6.9.1 | 7.0.1 | major, dev |
| @types/node | 25.9.9 | 26.6.5 | major types; Containerfile uses Node 22 |
| @types/better-sqlite3 | 7.6.13 | 9.6.0 | major types |
| typescript | 5.9.3 | 7.0.2 | major |
| vitest | 4.1.0 | 5.0.4 (4.1.11 in range) | see above |

## Not a dependency issue but found here

`npx vite build` (and therefore `npm run build` and the Containerfile build) fails on this branch, before and after the bumps: `Invalid export 'mcpGeneratorData' in src/routes/agents/[slug]/+page.server.ts`. SvelteKit allows only `load`, `prerender`, `csr`, `ssr`, `trailingSlash`, `config`, `actions`, `entries` and `_`-prefixed names from a `+page.server.ts`. `mcpGeneratorData` and `mcpTesterData` are exported for two existing tests, so `npm run check` stays green and hides it. Fix (needs test edits, so not done here): move both helpers to a `$lib` module and import them from there in the route and in `customize-button.mcp.test.ts` / `customize-button.mcptest.test.ts`. See `.planning/AUTONOMOUS-BLOCKERS.md` B-002. Verified identical with the original SvelteKit 2.55.0.

## Runtime dependency added: sax (D-560, 2026-10-14)

`sax@1.6.1` (exact pin) is the one XML dependency of the MCP generator, used only to read OData EDMX (`$metadata`) documents. Zero transitive dependencies, 62 kB, licence BlueOak-1.0.0, no published security advisory (GitHub security page, 2026-10-14). It is event based, never expands custom entities, and is loaded with a dynamic `import('sax')` only when an EDMX document is parsed. Inputs are pre-checked fail-closed (no DOCTYPE, no entity declaration, no processing instruction except the XML declaration) and capped (depth, element count, attribute count and length). Alternatives rejected: fast-xml-parser (6 transitive packages and entity-expansion CVEs in 2026), @xmldom/xmldom (ten advisories in August 2026, two of them quadratic time), saxes (unmaintained). `npm audit` after adding it: 9 findings (3 low, 6 moderate, 0 high), the same as before, with the same packages. Revisit when `sax` ships a release: `npm view sax version time.modified`, then `npm audit`.

## Re-running

```bash
npm audit
npm outdated
# in-range bumps, one package at a time (a bulk `npm update` hits the npm bug above)
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install <pkg>@<version>
npm run check
```
