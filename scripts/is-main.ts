// Shared "is this module the program entry" check for the scripts (CR-48, CR-49). Compares real file paths, so paths
// with spaces, '%' or non-ASCII characters (percent-encoded in a file URL), relative paths and symlinks all work. A
// plain string comparison of import.meta.url with argv[1] made a script exit 0 without running, which a CI step
// reads as a PASS (WR-09).
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function isMainModule(metaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false
  let self: string
  try {
    self = fileURLToPath(metaUrl)
  } catch {
    return false
  }
  const entry = resolve(argv1)
  try {
    return realpathSync(self) === realpathSync(entry)
  } catch {
    return self === entry
  }
}
