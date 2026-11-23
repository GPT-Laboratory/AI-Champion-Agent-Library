// Minimal Excel workbook (.xlsx, Office Open XML SpreadsheetML) writer on fflate. Client- and server-safe, no I/O.
// Writes text as inline strings and plain decimal numbers as numbers, a bold header row frozen at the top and
// column widths from the content. Nothing is ever written as a formula, so a cell that starts with "=" stays text.

import { strToU8, zipSync } from 'fflate'
import type { Block } from './resultMarkdown'

export type Cell = string | number | null

export interface Sheet {
  name: string
  rows: Cell[][]
  /** Bold and freeze the first row (default true). */
  header?: boolean
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Excel's own limits. */
const MAX_CELL_CHARS = 32767
const MAX_SHEET_NAME = 31

/** A plain decimal (no leading zeros, at most 15 significant integer digits) becomes a number; all else stays text. */
export function cellValue(s: string): Cell {
  const t = s.trim()
  if (t === '') return null
  return /^-?(0|[1-9]\d{0,14})(\.\d{1,10})?$/.test(t) ? Number(t) : s
}

// Characters XML 1.0 does not allow, removed rather than escaped.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

export function xmlEscape(s: string): string {
  return s
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A1-style column letters for a 0-based index (0 -> A, 26 -> AA). */
export function columnName(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** A valid, unique sheet name: no []:*?/\, at most 31 characters, not "History", not blank. */
export function sheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '')
  if (!base || base.toLowerCase() === 'history') base = base ? `${base} 1` : 'Sheet'
  base = base.slice(0, MAX_SHEET_NAME).trim()
  let name = base
  for (let n = 2; used.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`
    name = base.slice(0, MAX_SHEET_NAME - suffix.length).trim() + suffix
  }
  used.add(name.toLowerCase())
  return name
}

function cellXml(ref: string, v: Cell, bold: boolean): string {
  const s = bold ? ' s="1"' : ''
  if (v === null || v === '') return ''
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`
  const text = xmlEscape(String(v).slice(0, MAX_CELL_CHARS))
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${text}</t></is></c>`
}

function sheetXml(sheet: Sheet): string {
  const header = sheet.header !== false && sheet.rows.length > 0
  const width = Math.max(0, ...sheet.rows.map((r) => r.length))
  const widths = Array.from({ length: width }, (_, c) =>
    Math.min(60, Math.max(8, ...sheet.rows.map((r) => String(r[c] ?? '').length + 2))),
  )
  const cols = width
    ? `<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : ''
  const pane = header
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
  const rows = sheet.rows
    .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cellXml(`${columnName(ci)}${ri + 1}`, v, header && ri === 0)).join('')}</row>`)
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${rows}</sheetData></worksheet>`
  )
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

/** The workbook as .xlsx bytes. At least one sheet is written (an empty one when `sheets` is empty). */
export function xlsxBytes(sheets: Sheet[]): Uint8Array {
  const used = new Set<string>()
  const list = (sheets.length ? sheets : [{ name: 'Sheet', rows: [] }]).map((s) => ({ ...s, name: sheetName(s.name, used) }))
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        list
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join('') +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `${xml}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${rel}"><sheets>` +
        list.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${list.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(STYLES),
  }
  list.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))))
  return zipSync(files, { level: 6, mtime: new Date('2026-01-01T00:00:00Z') })
}

/** One sheet per table of a parsed document, named after the heading above it. */
export function tablesToSheets(blocks: Block[]): Sheet[] {
  return blocks
    .filter((b): b is Extract<Block, { kind: 'table' }> => b.kind === 'table')
    .map((t, i) => ({
      name: t.title ?? `Table ${i + 1}`,
      rows: [t.header.map((h) => h.replace(/`/g, '')), ...t.rows.map((r) => r.map((c) => cellValue(c.replace(/`/g, ''))))],
    }))
}
