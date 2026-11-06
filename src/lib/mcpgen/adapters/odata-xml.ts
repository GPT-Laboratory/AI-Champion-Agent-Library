// The only module that touches the XML dependency (D-560): `sax`, loaded with a dynamic import() so no other
// bundle (the Generate MCP panel imports the adapter registry client-side) pulls it in. Fail-closed:
//  1. a pre-check rejects every `<!` construct except comments and CDATA (so DOCTYPE and entity declarations
//     never reach the parser), and every processing instruction except a leading `<?xml ...?>`;
//  2. the parser is strict and namespace-aware and is never given entity options;
//  3. limits are enforced as events arrive (depth, element count, attributes per element, attribute length,
//     text per element) and an over-limit document stops at once by throwing from the handler.
// The result is a small tree of local names, unprefixed attributes and clipped text. Nothing is fetched.
import type sax from 'sax'
import { gap } from '../diagnostics.js'
import type { Gap } from '../types.js'

export const XML_LIMITS = {
  maxChars: 1_000_000,
  maxDepth: 32,
  maxElements: 20_000,
  maxAttributes: 64,
  maxAttributeLength: 4096,
  maxTextPerElement: 4096,
}

export interface XNode {
  /** Local element name (the prefix is dropped; `ns` keeps the namespace URI for the checks that need it). */
  name: string
  ns: string
  /** Unprefixed attributes only; namespace declarations and prefixed attributes are not kept. */
  attrs: Record<string, string>
  children: XNode[]
  text: string
}

type Sax = typeof sax
let saxModule: Sax | undefined

/** Load the parser. Called by `prepare` before a synchronous `parse`; a failure leaves the parser unavailable. */
export async function loadXmlParser(): Promise<void> {
  if (saxModule) return
  try {
    const mod = (await import('sax')) as unknown as { default?: Sax } & Sax
    saxModule = mod.default ?? mod
  } catch {
    saxModule = undefined
  }
}

export function xmlParserLoaded(): boolean {
  return saxModule !== undefined
}

const DECLARATION = /^\uFEFF?\s*<\?xml\s[^<>]*\?>/
const DOCTYPE_LIKE = /<!(?:doctype|entity|element|attlist|notation)/i
const BANG_NOT_COMMENT_OR_CDATA = /<!(?!--|\[CDATA\[)/

/** Linear pre-check; returns the gap that rejects the text, or undefined when it may be parsed. */
export function precheckXml(text: string): Gap | undefined {
  if (text.length > XML_LIMITS.maxChars) {
    return gap('xml-limit-exceeded', `The XML text is longer than ${XML_LIMITS.maxChars} characters.`, { severity: 'error' })
  }
  if (DOCTYPE_LIKE.test(text)) {
    return gap('doctype-rejected', 'The document declares a DOCTYPE or an entity or other markup declaration; these are never processed and the input was rejected.', { severity: 'error' })
  }
  if (BANG_NOT_COMMENT_OR_CDATA.test(text)) {
    return gap('xml-markup-rejected', 'The document contains a markup declaration that is not a comment or CDATA section; the input was rejected.', { severity: 'error' })
  }
  const decl = DECLARATION.exec(text)
  if (text.indexOf('<?', decl ? decl[0].length : 0) !== -1) {
    return gap('xml-pi-rejected', 'The document contains a processing instruction other than the XML declaration; the input was rejected. The check is textual, so a `<?` inside a CDATA section or a comment is rejected too.', { severity: 'error' })
  }
  return undefined
}

class XmlStop extends Error {
  constructor(readonly gap: Gap) {
    super(gap.code)
  }
}

function limit(code: string, message: string): XmlStop {
  return new XmlStop(gap(code, message, { severity: 'error' }))
}

/** Parse text into a tree. Never throws; every failure is a gap. The parser must have been loaded. */
export function parseXml(text: string): { root: XNode } | { gap: Gap } {
  const pre = precheckXml(text)
  if (pre) return { gap: pre }
  if (!saxModule) return { gap: gap('odata-xml-unavailable', 'The XML reader is not loaded (the adapter was used without its prepare step).', { severity: 'error' }) }
  const parser = saxModule.parser(true, { xmlns: true, trim: false, normalize: false })
  const stack: XNode[] = []
  let root: XNode | undefined
  let elements = 0
  parser.onerror = () => {
    throw new XmlStop(gap('xml-malformed', 'The XML text is not well formed.', { severity: 'error' }))
  }
  parser.onopentag = (tag) => {
    if (stack.length >= XML_LIMITS.maxDepth) throw limit('xml-depth-exceeded', `The XML nests deeper than ${XML_LIMITS.maxDepth} levels.`)
    if (++elements > XML_LIMITS.maxElements) throw limit('xml-limit-exceeded', `The XML has more than ${XML_LIMITS.maxElements} elements.`)
    if (stack.length === 0 && root) throw new XmlStop(gap('xml-malformed', 'The XML text has more than one root element.', { severity: 'error' }))
    const all = Object.values(tag.attributes)
    if (all.length > XML_LIMITS.maxAttributes) throw limit('xml-limit-exceeded', `An element has more than ${XML_LIMITS.maxAttributes} attributes.`)
    const attrs: Record<string, string> = Object.create(null)
    for (const a of all) {
      if (a.value.length > XML_LIMITS.maxAttributeLength) throw limit('xml-limit-exceeded', `An attribute value is longer than ${XML_LIMITS.maxAttributeLength} characters.`)
      if (a.prefix === '' && a.uri === '' && a.name !== 'xmlns') attrs[a.local] = a.value
    }
    const node: XNode = { name: tag.local, ns: tag.uri, attrs, children: [], text: '' }
    if (stack.length > 0) stack[stack.length - 1].children.push(node)
    else root = node
    stack.push(node)
  }
  parser.onclosetag = () => {
    stack.pop()
  }
  const addText = (t: string) => {
    const top = stack[stack.length - 1]
    if (top && top.text.length < XML_LIMITS.maxTextPerElement) top.text = (top.text + t).slice(0, XML_LIMITS.maxTextPerElement)
  }
  parser.ontext = addText
  parser.oncdata = addText
  try {
    parser.write(text).close()
  } catch (e) {
    return { gap: e instanceof XmlStop ? e.gap : gap('xml-malformed', 'The XML text could not be read.', { severity: 'error' }) }
  }
  if (!root || stack.length > 0) return { gap: gap('xml-malformed', 'The XML text is not well formed.', { severity: 'error' }) }
  return { root }
}
