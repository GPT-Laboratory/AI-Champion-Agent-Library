// Schema of mcptest-binding.json (E10 D3). Pure: zod only. Shared by the driver request, the package loader and the
// in-process generator subject. The file comes from the package under test, so it is validated strictly and capped.
import { z } from 'zod'

export const BINDING_FILE_MAX_BYTES = 64 * 1024
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

export const BindingEntrySchema = z
  .object({
    tool: z.string().min(1).max(100),
    args: z.record(z.string(), z.unknown()).optional(),
    argMap: z
      .record(z.string().regex(IDENT).max(64), z.string().regex(IDENT).max(64))
      .refine((m) => !Object.prototype.hasOwnProperty.call(m, '__proto__'), 'reserved key')
      .optional()
  })
  .strict()

export const BindingSchema = z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/), BindingEntrySchema)
export type BindingFile = z.infer<typeof BindingSchema>

/** Parses the text of a binding file; null when it is absent-looking, oversize, not JSON or off-schema. */
export function parseBindingFile(text: string): BindingFile | null {
  if (!text || Buffer.byteLength(text, 'utf8') > BINDING_FILE_MAX_BYTES) return null
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const r = BindingSchema.safeParse(json)
  return r.success ? r.data : null
}
