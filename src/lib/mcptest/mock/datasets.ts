// Seeded synthetic datasets for the mock upstream. All content invented (Acme / Example).
import { mulberry32, pick } from './prng'
import type { DatasetName } from './contract'

export interface Attribute {
  key: string
  value: string
}
export interface CatalogItem {
  id: string
  code: string
  name: { en: string; fi: string; sv: string }
  category: string
  supplier: { id: string; name: string }
  attributes: Attribute[]
  [field: string]: unknown
}

export const CATEGORIES = ['Bearings', 'Valves', 'Sensors', 'Pumps'] as const
export const SUPPLIER_COUNT = 4
export const KNOWN_ITEM_ID = 'ACM-000042'
export const MISSING_ITEM_ID = 'ACM-999999'

const NOUNS: ReadonlyArray<readonly [string, string, string]> = [
  ['Bearing', 'Laakeri', 'Lager'],
  ['Valve', 'Venttiili', 'Ventil'],
  ['Sensor', 'Anturi', 'Sensor'],
  ['Pump', 'Pumppu', 'Pump'],
  ['Gasket', 'Tiiviste', 'Packning'],
  ['Switch', 'Kytkin', 'Brytare'],
]
const COLOURS = ['Blue', 'Green', 'Black', 'Silver'] as const
const MATERIALS = ['Steel', 'Brass', 'Nylon', 'Aluminium'] as const
const COUNTRIES = ['Finland', 'Sweden', 'Estonia', 'Norway'] as const

const pad = (n: number, w: number) => String(n).padStart(w, '0')

/** EAN-13 check digit for a 12-digit base. */
export function checkDigit(base12: string): number {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(base12[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10
}
/** True for 13 digits whose last digit is the correct check digit. */
export function isValidCode(code: string): boolean {
  return /^\d{13}$/.test(code) && checkDigit(code.slice(0, 12)) === Number(code[12])
}
/** Invented 13-digit code with a valid check digit (prefix 990 is an arbitrary mock prefix). */
export function codeFor(i: number): string {
  const base = '990' + pad(i, 9)
  return base + checkDigit(base)
}

export function catalogItems(seed: number, size = 400): CatalogItem[] {
  const rand = mulberry32(seed)
  const items: CatalogItem[] = []
  for (let i = 1; i <= size; i++) {
    const [en, fi, sv] = pick(rand, NOUNS)
    const model = 100 + Math.floor(rand() * 900)
    const supplierN = (i % SUPPLIER_COUNT) + 1
    const known = i === 42
    const category = known ? 'Bearings' : CATEGORIES[Math.floor(i / 3) % CATEGORIES.length]
    const colour = known ? 'Silver' : i % 25 === 0 ? 'Red' : pick(rand, COLOURS)
    const attributes: Attribute[] = [
      { key: 'Colour', value: colour },
      { key: 'Material', value: pick(rand, MATERIALS) },
    ]
    if (rand() < 0.5) attributes.push({ key: 'Voltage', value: pick(rand, ['12 V', '24 V', '230 V']) })
    const created = 1_600_000_000_000 + Math.floor(rand() * 90_000_000_000)
    items.push({
      id: 'ACM-' + pad(i, 6),
      code: codeFor(i),
      name: known
        ? { en: 'Acme Reference Bearing', fi: 'Acme Viitelaakeri (pääsarja)', sv: 'Acme Referenslager (säker)' }
        : {
            en: `Acme ${en} ${model}`,
            fi: `Acme ${fi} ${model} (pääsarja)`,
            sv: `Acme ${sv} ${model} (säker)`,
          },
      category,
      supplier: { id: 'SUP-' + pad(supplierN, 3), name: `Example Supplier ${supplierN}` },
      attributes,
      description: `Invented catalogue entry ${i} for offline testing.`,
      width_mm: 10 + Math.floor(rand() * 200),
      height_mm: 10 + Math.floor(rand() * 200),
      depth_mm: 10 + Math.floor(rand() * 200),
      weight_g: 50 + Math.floor(rand() * 5000),
      price_eur: Math.round(rand() * 50000) / 100,
      currency: 'EUR',
      vat_rate: 0.255,
      created_at: new Date(created).toISOString(),
      updated_at: new Date(created + 86_400_000).toISOString(),
      in_stock: rand() < 0.8,
      stock_qty: Math.floor(rand() * 500),
      min_order_qty: 1 + Math.floor(rand() * 10),
      lead_time_days: Math.floor(rand() * 30),
      country_of_origin: pick(rand, COUNTRIES),
      warranty_months: pick(rand, [12, 24, 36]),
      discontinued: rand() < 0.05,
      tags: ['acme', category.toLowerCase()],
      unit: 'pcs',
      package_size: pick(rand, [1, 5, 10, 25]),
    })
  }
  return items
}

export function bulkItems(seed: number, size = 5000): CatalogItem[] {
  return catalogItems(seed + 7919, size)
}

export interface Product {
  gtin: string
  name: string
}
export interface CodesDataset {
  valid: Product[]
  invalid: string[]
}
export function codesDataset(seed: number, size = 20): CodesDataset {
  const rand = mulberry32(seed + 31)
  const valid: Product[] = []
  const invalid: string[] = []
  for (let i = 1; i <= size; i++) {
    const gtin = codeFor(1000 + i)
    valid.push({ gtin, name: `Acme Product ${i}` })
    const wrong = (Number(gtin[12]) + 1 + Math.floor(rand() * 8)) % 10
    invalid.push(gtin.slice(0, 12) + wrong)
  }
  return { valid, invalid }
}

export interface Widget {
  id: string
  name: string
  size: string
}
export interface DocsDataset {
  widgets: Widget[]
  documentedRoutes: string[]
}
export function docsDataset(_seed: number): DocsDataset {
  const widgets = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].map((n, i) => ({
    id: 'WGT-' + pad(i + 1, 3),
    name: `Example Widget ${n}`,
    size: ['S', 'M', 'L'][i % 3],
  }))
  return { widgets, documentedRoutes: ['/widgets', '/widgets/:id'] }
}

export interface Component {
  id: string
  name: string
  mass_g: number
}
export function componentsDataset(seed: number, size = 10): Component[] {
  const rand = mulberry32(seed + 53)
  return Array.from({ length: size }, (_, i) => ({
    id: 'CMP-' + pad(i + 1, 4),
    name: `Acme Component ${i + 1}`,
    mass_g: 10 + Math.floor(rand() * 900),
  }))
}

export interface Assembly {
  id: string
  componentId: string
  parts: number
  supplier: string
}
/** The 'products' dataset: assemblies joined to components by component id. */
export function assembliesDataset(seed: number, size = 10): Assembly[] {
  const rand = mulberry32(seed + 97)
  return Array.from({ length: size }, (_, i) => ({
    id: 'ASM-' + pad(i + 1, 4),
    componentId: 'CMP-' + pad(i + 1, 4),
    parts: 2 + Math.floor(rand() * 20),
    supplier: `Example Supplier ${(i % SUPPLIER_COUNT) + 1}`,
  }))
}

export const VOCABULARIES: Record<string, string[]> = {
  colour: ['Blue', 'Green', 'Black', 'Silver', 'Red'],
  material: [...MATERIALS],
}

export function makeDataset(name: DatasetName, seed: number, size?: number): unknown {
  switch (name) {
    case 'catalog':
      return catalogItems(seed, size)
    case 'bulk':
      return bulkItems(seed, size)
    case 'codes':
      return codesDataset(seed, size)
    case 'docs':
      return docsDataset(seed)
    case 'components':
      return componentsDataset(seed, size)
    case 'products':
      return assembliesDataset(seed, size)
  }
}
