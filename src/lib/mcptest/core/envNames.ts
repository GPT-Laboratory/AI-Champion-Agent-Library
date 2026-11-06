// Environment variable names a test request or subject declaration may never set on a spawned server (WR-10).
// They change how the interpreter or loader behaves (PATH, LD_PRELOAD, NODE_OPTIONS, PYTHONPATH ...), so a name
// supplied from outside the platform must not be one of them. Pure; core purity: no $lib, svelte or @sveltejs imports.

const EXACT = new Set([
  'PATH',
  'HOME',
  'LANG',
  'LANGUAGE',
  'TMPDIR',
  'SHELL',
  'IFS',
  'PWD',
  'OLDPWD',
  'BASH_ENV',
  'ENV',
  'PS4',
  'USER',
  'LOGNAME'
])
const PREFIXES = ['LC_', 'LD_', 'DYLD_', 'NODE_', 'NPM_', 'PYTHON', 'PIP_']

export function isReservedEnvName(name: string): boolean {
  if (typeof name !== 'string') return true
  const n = name.toUpperCase()
  return EXACT.has(n) || PREFIXES.some((p) => n.startsWith(p))
}
