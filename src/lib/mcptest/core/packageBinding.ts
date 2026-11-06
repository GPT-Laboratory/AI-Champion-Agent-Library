// Loads <package>/mcptest-binding.json for subjects that run a server from a package directory (cmd: and container).
// Explicit binding wins over the suite's regex hints (bindTool). Never throws: a missing or invalid file is no binding.
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BINDING_FILE_MAX_BYTES, parseBindingFile, type BindingFile } from './bindingSchema'

export const PACKAGE_BINDING_FILE = 'mcptest-binding.json'

export async function loadPackageBinding(dir: string): Promise<BindingFile | undefined> {
  try {
    const p = join(dir, PACKAGE_BINDING_FILE)
    const st = await lstat(p) // the entry itself: a symlink is not a binding file (CR-36)
    if (!st.isFile() || st.size > BINDING_FILE_MAX_BYTES) return undefined
    const parsed = parseBindingFile(await readFile(p, 'utf8'))
    return parsed && Object.keys(parsed).length > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}
