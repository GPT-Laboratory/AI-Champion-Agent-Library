/**
 * Dependency-free WCAG 2.x contrast calculator plus the colour tokens and
 * foreground/background pairs actually used in the UI.
 *
 * Token values are the Tailwind v4 default theme (node_modules/tailwindcss/theme.css),
 * which ships oklch; oklchToHex converts them to sRGB so the numbers are exact.
 */

/** Convert "oklch(L% C H)" to an sRGB hex string (gamut-clipped). */
export function oklchToHex(input: string): string {
  const m = /oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(input)
  if (!m) throw new Error(`Unparseable oklch value: ${input}`)
  const L = Number(m[1]) / 100
  const C = Number(m[2])
  const h = (Number(m[3]) * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  const enc = (v: number) => {
    const c = Math.min(1, Math.max(0, v))
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
  }
  return (
    '#' +
    lin
      .map((v) => Math.round(enc(v) * 255).toString(16).padStart(2, '0'))
      .join('')
  )
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Bad hex colour: ${hex}`)
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

/** WCAG relative luminance of an sRGB hex colour. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio (1..21) between two hex colours. */
export function contrastRatio(fgHex: string, bgHex: string): number {
  const a = relativeLuminance(fgHex)
  const b = relativeLuminance(bgHex)
  const [hi, lo] = a >= b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

export const OKLCH: Record<string, string> = {
  'gray-50': 'oklch(98.5% 0.002 247.839)',
  'gray-100': 'oklch(96.7% 0.003 264.542)',
  'gray-200': 'oklch(92.8% 0.006 264.531)',
  'gray-300': 'oklch(87.2% 0.01 258.338)',
  'gray-400': 'oklch(70.7% 0.022 261.325)',
  'gray-500': 'oklch(55.1% 0.027 264.364)',
  'gray-600': 'oklch(44.6% 0.03 256.802)',
  'gray-700': 'oklch(37.3% 0.034 259.733)',
  'gray-800': 'oklch(27.8% 0.033 256.848)',
  'gray-900': 'oklch(21% 0.034 264.665)',
  'indigo-50': 'oklch(96.2% 0.018 272.314)',
  'indigo-200': 'oklch(87% 0.065 274.039)',
  'indigo-500': 'oklch(58.5% 0.233 277.117)',
  'indigo-600': 'oklch(51.1% 0.262 276.966)',
  'indigo-700': 'oklch(45.7% 0.24 277.023)',
  'green-50': 'oklch(98.2% 0.018 155.826)',
  'green-100': 'oklch(96.2% 0.044 156.743)',
  'green-200': 'oklch(92.5% 0.084 155.995)',
  'green-300': 'oklch(87.1% 0.15 154.449)',
  'green-800': 'oklch(44.8% 0.119 151.328)',
  'green-900': 'oklch(39.3% 0.095 152.535)',
  'yellow-50': 'oklch(98.7% 0.026 102.212)',
  'yellow-100': 'oklch(97.3% 0.071 103.193)',
  'yellow-200': 'oklch(94.5% 0.129 101.54)',
  'yellow-800': 'oklch(47.6% 0.114 61.907)',
  'yellow-900': 'oklch(42.1% 0.095 57.708)',
  'amber-50': 'oklch(98.7% 0.022 95.277)',
  'amber-300': 'oklch(87.9% 0.169 91.605)',
  'amber-900': 'oklch(41.4% 0.112 45.904)',
  'red-50': 'oklch(97.1% 0.013 17.38)',
  'red-200': 'oklch(88.5% 0.062 18.334)',
  'red-700': 'oklch(50.5% 0.213 27.518)',
  'red-800': 'oklch(44.4% 0.177 26.899)',
  'blue-500': 'oklch(62.3% 0.214 259.815)',
  'blue-700': 'oklch(48.8% 0.243 264.376)',
  'blue-800': 'oklch(42.4% 0.199 265.638)',
}

/** Tailwind token name -> sRGB hex. */
export const TOKENS: Record<string, string> = {
  white: '#ffffff',
  ...Object.fromEntries(Object.entries(OKLCH).map(([k, v]) => [k, oklchToHex(v)])),
}

export interface ContrastPair {
  name: string
  fg: string
  bg: string
  /** 4.5 normal text, 3.0 large text or UI component boundary / focus indicator. */
  minRatio: number
  where: string
  /** Known to fail today; the 10-02 token fix removes this flag. */
  knownFailing?: boolean
}

const T = 4.5
const U = 3.0

/** Real foreground/background combinations found in src/routes and src/lib/components. */
export const PAIRS: ContrastPair[] = [
  // Disabled controls (white on gray-400) are exempt from 1.4.3 and not listed.
  // Body text on page / card backgrounds
  { name: 'heading gray-900 on white', fg: 'gray-900', bg: 'white', minRatio: T, where: 'headings, card titles' },
  { name: 'heading gray-900 on gray-50', fg: 'gray-900', bg: 'gray-50', minRatio: T, where: 'detail spec blocks' },
  { name: 'body gray-600 on white', fg: 'gray-600', bg: 'white', minRatio: T, where: 'summaries, pagination' },
  { name: 'body gray-600 on gray-50', fg: 'gray-600', bg: 'gray-50', minRatio: T, where: 'TechAccordion body' },
  { name: 'label gray-700 on white', fg: 'gray-700', bg: 'white', minRatio: T, where: 'FilterBar labels, accordion summary' },
  { name: 'label gray-700 on gray-50', fg: 'gray-700', bg: 'gray-50', minRatio: T, where: 'TechAccordion code block' },
  { name: 'label gray-800 on white', fg: 'gray-800', bg: 'white', minRatio: T, where: 'login/TryOutPanel labels' },
  { name: 'hint gray-500 on white', fg: 'gray-500', bg: 'white', minRatio: T, where: 'back link, helper text' },
  { name: 'hint gray-500 on gray-50', fg: 'gray-500', bg: 'gray-50', minRatio: T, where: 'CustomizeMenu disabled item hover' },
  // Badges and tags
  { name: 'tag gray-600 on gray-100', fg: 'gray-600', bg: 'gray-100', minRatio: T, where: 'tags, maturity "Draft" badge' },
  { name: 'badge green-800 on green-100', fg: 'green-800', bg: 'green-100', minRatio: T, where: 'maturity badge' },
  { name: 'badge yellow-800 on yellow-100', fg: 'yellow-800', bg: 'yellow-100', minRatio: T, where: 'maturity badge' },
  { name: 'badge indigo-700 on indigo-50', fg: 'indigo-700', bg: 'indigo-50', minRatio: T, where: 'CustomizationPanel badge' },
  // Links and buttons
  { name: 'link indigo-600 on white', fg: 'indigo-600', bg: 'white', minRatio: T, where: 'category, links, Customize trigger' },
  { name: 'link indigo-600 on indigo-50 (hover)', fg: 'indigo-600', bg: 'indigo-50', minRatio: T, where: 'Customize trigger hover' },
  { name: 'link blue-700 on white', fg: 'blue-700', bg: 'white', minRatio: T, where: 'layout header link, login' },
  { name: 'link hover indigo-700 on white', fg: 'indigo-700', bg: 'white', minRatio: T, where: 'AgentCard link hover' },
  { name: 'button white on indigo-600', fg: 'white', bg: 'indigo-600', minRatio: T, where: 'primary buttons' },
  { name: 'button white on indigo-700 (hover)', fg: 'white', bg: 'indigo-700', minRatio: T, where: 'primary button hover' },
  { name: 'button white on blue-700', fg: 'white', bg: 'blue-700', minRatio: T, where: 'login buttons' },
  { name: 'button white on blue-800 (hover)', fg: 'white', bg: 'blue-800', minRatio: T, where: 'login button hover' },
  // Alerts
  { name: 'error red-800 on red-50', fg: 'red-800', bg: 'red-50', minRatio: T, where: 'login error' },
  { name: 'error red-700 on white', fg: 'red-700', bg: 'white', minRatio: T, where: 'TryItOutPanel errors' },
  { name: 'success green-800 on green-50', fg: 'green-800', bg: 'green-50', minRatio: T, where: 'login success' },
  { name: 'success green-900 on green-50', fg: 'green-900', bg: 'green-50', minRatio: T, where: 'TryOutPanel result' },
  { name: 'success green-800 on white', fg: 'green-800', bg: 'white', minRatio: T, where: 'TryOutPanel button' },
  { name: 'warning amber-900 on amber-50', fg: 'amber-900', bg: 'amber-50', minRatio: T, where: 'degraded search notice' },
  { name: 'warning yellow-900 on yellow-50', fg: 'yellow-900', bg: 'yellow-50', minRatio: T, where: 'TryOutPanel notice' },
  // Non-text (1.4.11): control boundaries and focus indicators
  { name: 'focus ring indigo-600 on white', fg: 'indigo-600', bg: 'white', minRatio: U, where: 'focus-visible ring' },
  { name: 'focus ring indigo-500 on white', fg: 'indigo-500', bg: 'white', minRatio: U, where: 'focus ring variant' },
  { name: 'input border gray-500 on white', fg: 'gray-500', bg: 'white', minRatio: U, where: 'search input, selects, pagination, login, try-it-out inputs' },
  { name: 'login focus ring blue-700 on white', fg: 'blue-700', bg: 'white', minRatio: U, where: 'login input focus ring' },
]
