/**
 * UI-02 dark theme palette and contrast pairs (UI_DARK_MODE, D-380..D-384).
 *
 * Extends the Phase 10 calculator in contrast.ts (reused, no new deps). The dark palette mirrors
 * the light one: every Tailwind colour token the UI uses is remapped (in src/app.css, under
 * html[data-theme="dark"]) to the opposite end of its own scale, so no component class changes.
 * DARK_SWAP is the single source of truth; app.css must carry the exact oklch values it produces
 * (darkTheme.css.test.ts) and every light pair is re-checked through the swap (contrast.dark.test.ts).
 */
import { OKLCH, PAIRS, TOKENS, contrastRatio, oklchToHex, type ContrastPair } from './contrast'

/** Extra Tailwind v4 default-theme values needed only by the dark mapping or the extra pairs. */
const EXTRA_OKLCH: Record<string, string> = {
  'gray-950': 'oklch(13% 0.028 261.692)',
  'slate-50': 'oklch(98.4% 0.003 247.858)',
  'slate-200': 'oklch(92.9% 0.013 255.508)',
  'slate-700': 'oklch(37.2% 0.044 257.287)',
  'slate-900': 'oklch(20.8% 0.042 265.755)',
  'indigo-300': 'oklch(78.5% 0.115 274.713)',
  'indigo-400': 'oklch(67.3% 0.182 276.935)',
  'indigo-800': 'oklch(39.8% 0.195 277.366)',
  'indigo-950': 'oklch(25.7% 0.09 281.288)',
  'green-700': 'oklch(52.7% 0.154 150.069)',
  'green-950': 'oklch(26.6% 0.065 152.934)',
  'yellow-300': 'oklch(90.5% 0.182 98.111)',
  'yellow-700': 'oklch(55.4% 0.135 66.442)',
  'yellow-950': 'oklch(28.6% 0.066 53.813)',
  'amber-100': 'oklch(96.2% 0.059 95.617)',
  'amber-700': 'oklch(55.5% 0.163 48.998)',
  'amber-950': 'oklch(27.9% 0.077 45.635)',
  'red-100': 'oklch(93.6% 0.032 17.717)',
  'red-300': 'oklch(80.8% 0.114 19.571)',
  'red-900': 'oklch(39.6% 0.141 25.723)',
  'red-950': 'oklch(25.8% 0.092 26.042)',
  'blue-200': 'oklch(88.2% 0.059 254.128)',
  'blue-300': 'oklch(80.9% 0.105 251.813)',
  'blue-400': 'oklch(70.7% 0.165 254.624)',
  'emerald-100': 'oklch(95% 0.052 163.051)',
  'emerald-900': 'oklch(37.8% 0.077 168.94)',
}

/** Light token -> the token whose value it takes in dark mode. */
export const DARK_SWAP: Record<string, string> = {
  white: 'gray-950',
  'gray-50': 'gray-900', 'gray-100': 'gray-800', 'gray-200': 'gray-700', 'gray-300': 'gray-600',
  'gray-400': 'gray-500', 'gray-500': 'gray-400', 'gray-600': 'gray-300', 'gray-700': 'gray-200',
  'gray-800': 'gray-100', 'gray-900': 'gray-50',
  'slate-50': 'slate-900', 'slate-200': 'slate-700', 'slate-700': 'slate-200', 'slate-900': 'slate-50',
  'indigo-50': 'indigo-950', 'indigo-200': 'indigo-800', 'indigo-300': 'indigo-700', 'indigo-500': 'indigo-400',
  'indigo-600': 'indigo-400', 'indigo-700': 'indigo-300', 'indigo-800': 'indigo-200',
  'green-50': 'green-950', 'green-100': 'green-900', 'green-200': 'green-800', 'green-300': 'green-700',
  'green-800': 'green-200', 'green-900': 'green-100',
  'yellow-50': 'yellow-950', 'yellow-100': 'yellow-900', 'yellow-200': 'yellow-800', 'yellow-700': 'yellow-300',
  'yellow-800': 'yellow-200', 'yellow-900': 'yellow-100',
  'amber-50': 'amber-950', 'amber-300': 'amber-700', 'amber-700': 'amber-300', 'amber-900': 'amber-100',
  'red-50': 'red-950', 'red-100': 'red-900', 'red-200': 'red-800', 'red-700': 'red-300',
  'red-800': 'red-200', 'red-900': 'red-100',
  'blue-500': 'blue-400', 'blue-700': 'blue-300', 'blue-800': 'blue-200',
  'emerald-900': 'emerald-100',
}

/** Every Tailwind default-theme oklch value this module knows (light palette + extras). */
export const ALL_OKLCH: Record<string, string> = { ...OKLCH, ...EXTRA_OKLCH }

/** Variable name (without --color-) -> oklch value it has in dark mode. */
export const DARK_OKLCH: Record<string, string> = Object.fromEntries(
  Object.entries(DARK_SWAP).map(([light, src]) => {
    const v = src === 'white' ? 'oklch(100% 0 0)' : ALL_OKLCH[src]
    if (!v) throw new Error(`DARK_SWAP source token missing: ${src}`)
    return [light, v]
  }),
)

/** Token -> sRGB hex as rendered in dark mode (remapped tokens take their dark value). */
export const DARK_TOKENS: Record<string, string> = {
  ...TOKENS,
  ...Object.fromEntries(Object.entries(ALL_OKLCH).map(([k, v]) => [k, oklchToHex(v)])),
  ...Object.fromEntries(Object.entries(DARK_OKLCH).map(([k, v]) => [k, oklchToHex(v)])),
}

const T = 4.5
const U = 3.0

/** Pairs added for the themed surfaces (header, toggle, spec viewer, panels). */
const EXTRA_PAIRS: ContrastPair[] = [
  { name: 'toggle gray-900 on gray-100', fg: 'gray-900', bg: 'gray-100', minRatio: T, where: 'ThemeToggle idle button in header' },
  { name: 'toggle white on indigo-600 (pressed)', fg: 'white', bg: 'indigo-600', minRatio: T, where: 'ThemeToggle pressed button' },
  { name: 'header link blue-700 on gray-100', fg: 'blue-700', bg: 'gray-100', minRatio: T, where: 'Sign out in header' },
  { name: 'spec slate-900 on slate-50', fg: 'slate-900', bg: 'slate-50', minRatio: T, where: 'SpecViewer code' },
  { name: 'spec indigo-800 on slate-50', fg: 'indigo-800', bg: 'slate-50', minRatio: T, where: 'SpecViewer keys' },
  { name: 'spec emerald-900 on slate-50', fg: 'emerald-900', bg: 'slate-50', minRatio: T, where: 'SpecViewer strings' },
  { name: 'spec amber-900 on slate-50', fg: 'amber-900', bg: 'slate-50', minRatio: T, where: 'SpecViewer values' },
  { name: 'spec slate-700 on white', fg: 'slate-700', bg: 'white', minRatio: T, where: 'SpecViewer note' },
  { name: 'blocker red-900 on red-100', fg: 'red-900', bg: 'red-100', minRatio: T, where: 'McpTestPanel flag' },
  { name: 'warn yellow-900 on yellow-100', fg: 'yellow-900', bg: 'yellow-100', minRatio: T, where: 'McpTestPanel flag' },
  { name: 'Differs amber-900 on white', fg: 'amber-900', bg: 'white', minRatio: T, where: 'compare badge' },
  { name: 'Differs border amber-700 on white', fg: 'amber-700', bg: 'white', minRatio: U, where: 'compare badge border' },
  { name: 'error red-700 on gray-50', fg: 'red-700', bg: 'gray-50', minRatio: T, where: 'panel errors' },
]

/** Every light pair plus the extras; evaluate with darkContrast(). All must meet minRatio. */
export const DARK_PAIRS: ContrastPair[] = [...PAIRS, ...EXTRA_PAIRS].map((p) => ({
  ...p,
  name: `[dark] ${p.name}`,
  knownFailing: undefined,
}))

export function darkContrast(p: ContrastPair): number {
  return contrastRatio(DARK_TOKENS[p.fg], DARK_TOKENS[p.bg])
}
