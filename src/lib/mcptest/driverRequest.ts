// Single shared definition of the in-container driver request (plan 15-10; imported by the host side in 15-11).
// Pure: zod only, no server imports, no I/O.
import { z } from 'zod'
import { BindingSchema } from './core/bindingSchema'
import { isReservedEnvName } from './core/envNames'

export const DRIVER_REQUEST_MAX_BYTES = 64 * 1024
export const DRIVER_PKG_ROOT = '/work/pkg'

/** Ids of the shipped suite cases (a test pins this list to the suite directory). */
export const KNOWN_CASE_IDS = [
  'T1-STD-CATALOG',
  'T2-CATALOG-API',
  'T2-CATALOG-DUMP',
  'T2-CATALOG-HTTP',
  'T3-COMPOSITE',
  'T3-LARGE-RESP',
  'T3-PROFILE-CONTRACT',
  'T3-RT-DOCS',
  'T4-FAULT-UPSTREAM',
  'T4-I18N-CODES',
  'T4-PARTIAL-SPEC',
  'T4-SEC-SECRETS'
] as const

const ENV_NAME = /^[A-Z][A-Z0-9_]{1,63}$/
// WR-10: no PATH, HOME, LANG, LD_*, NODE_*, PYTHON* and similar loader or interpreter variables.
const envName = z
  .string()
  .regex(ENV_NAME)
  .refine((s) => !isReservedEnvName(s), 'reserved environment variable name')
const CONTROL = /[\u0000-\u001f\u007f\\]/
/** Script the interpreter runs: the first argument must be a script file, never an option. */
const SCRIPT_EXT = /\.(py|js|mjs|cjs)$/

/** Relative path: no absolute, no '..' segment, no control chars or backslashes. */
const relArg = z
  .string()
  .min(1)
  .max(200)
  .refine((s) => !CONTROL.test(s), 'control characters or backslash')
  .refine((s) => !s.startsWith('/') && !/^[A-Za-z]:/.test(s), 'absolute path')
  .refine((s) => !s.split('/').includes('..'), "'..' segment")
  // WR-10: an argument starting with '-' is an interpreter option (-c, -m, -e, -p, --eval ...).
  .refine((s) => !s.startsWith('-'), 'option-like argument')

/** cwd must be the package root or below it (root overridable by the driver for tests). */
const cwdPath = z
  .string()
  .max(300)
  .refine((s) => !CONTROL.test(s), 'control characters or backslash')
  .refine((s) => s === DRIVER_PKG_ROOT || s.startsWith(`${DRIVER_PKG_ROOT}/`), `cwd outside ${DRIVER_PKG_ROOT}`)
  .refine((s) => !s.split('/').includes('..'), "'..' segment")

const Staged = z
  .object({
    kind: z.literal('staged'),
    command: z.enum(['python3', 'node']),
    args: z
      .array(relArg)
      .max(8)
      .refine((a) => a.length > 0 && SCRIPT_EXT.test(a[0]), 'the first argument must be a .py, .js, .mjs or .cjs script'),
    cwd: cwdPath,
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9:._-]+$/),
    binding: BindingSchema.optional(),
    envNames: z.object({ baseUrl: envName.optional(), apiKey: envName.optional(), baseUrlB: envName.optional() }).strict().optional()
  })
  .strict()

const Fake = z.object({ kind: z.literal('fake'), variant: z.string().regex(/^[a-z0-9-]{1,40}$/) }).strict()

export const DriverRequestSchema = z
  .object({
    v: z.literal(1),
    subject: z.discriminatedUnion('kind', [Staged, Fake]),
    cases: z.array(z.enum(KNOWN_CASE_IDS)).max(12).optional(),
    reruns: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional()
  })
  .strict()

export type DriverRequest = z.infer<typeof DriverRequestSchema>
