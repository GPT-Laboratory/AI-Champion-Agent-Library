// src/lib/server/tryitout/artifact.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// Zip building shared by the container path and the direct-LLM fallback (D-13/D-14).

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { artifactZipPath, outputDir, workDir } from '../tryItOutJobs'
import { isSafeRelativePath } from './runtime'

export const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024
export const MAX_ARTIFACT_FILES = 200

export function zipFiles(files: Record<string, Uint8Array>): Uint8Array {
  const names = Object.keys(files)
  if (names.length > MAX_ARTIFACT_FILES) {
    throw new Error(`artifact exceeds ${MAX_ARTIFACT_FILES} files`)
  }
  let total = 0
  for (const name of names) {
    if (!isSafeRelativePath(name)) {
      throw new Error(`unsafe artifact entry name: ${name}`)
    }
    total += files[name].byteLength
    if (total > MAX_ARTIFACT_BYTES) {
      throw new Error(`artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`)
    }
  }
  return zipSync(files, { level: 6 })
}

export async function writeArtifactZip(
  jobId: string,
  files: Record<string, Uint8Array>,
): Promise<string> {
  const zip = zipFiles(files)
  const path = artifactZipPath(jobId)
  await mkdir(workDir(jobId), { recursive: true })
  await writeFile(path, zip)
  return path
}

async function collect(
  root: string,
  rel: string,
  out: Record<string, Uint8Array>,
): Promise<void> {
  const entries = await readdir(join(root, rel), { withFileTypes: true })
  for (const entry of entries) {
    const relName = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      await collect(root, relName, out)
    } else if (entry.isFile()) {
      // Dirent reports symlinks as non-files, so they are skipped (T8-04-3).
      out[relName] = new Uint8Array(await readFile(join(root, relName)))
    }
  }
}

export async function zipOutputDir(jobId: string): Promise<string> {
  const files: Record<string, Uint8Array> = {}
  await collect(outputDir(jobId), '', files)
  return writeArtifactZip(jobId, files)
}
