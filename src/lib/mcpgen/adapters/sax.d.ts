// Minimal typing for the one part of sax@1.6.1 the EDMX reader uses (no @types/sax: D-560 allows one dependency).
declare module 'sax' {
  export interface QualifiedAttribute {
    name: string
    value: string
    prefix: string
    local: string
    uri: string
  }
  export interface QualifiedTag {
    name: string
    prefix: string
    local: string
    uri: string
    attributes: Record<string, QualifiedAttribute>
    isSelfClosing: boolean
  }
  export interface SAXParser {
    onopentag?: (tag: QualifiedTag) => void
    onclosetag?: (name: string) => void
    ontext?: (text: string) => void
    oncdata?: (text: string) => void
    onerror?: (error: Error) => void
    write(chunk: string): SAXParser
    close(): SAXParser
  }
  export function parser(strict: boolean, options?: { xmlns?: boolean; trim?: boolean; normalize?: boolean; position?: boolean }): SAXParser
  const sax: { parser: typeof parser }
  export default sax
}
