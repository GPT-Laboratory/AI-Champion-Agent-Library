// OData CSDL readers: CSDL JSON (4.0, 4.01) and EDMX XML (4.0, 4.01) into one small intermediate form.
// Nothing here fetches anything: `Reference` and `Annotations` are counted for a gap, never followed, and no
// URI from the document is kept. Inline annotations are read for three terms only (Core.Description,
// Capabilities.FilterRestrictions, Authorization.Authorizations); all others are counted.
import { gap } from '../diagnostics.js'
import type { Gap } from '../types.js'
import type { XNode } from './odata-xml.js'

export interface PropIR {
  name: string
  type: string
  collection: boolean
}
export interface EntityTypeIR {
  name: string
  base?: string
  abstract: boolean
  open: boolean
  key: string[]
  keyUnsupported: boolean
  props: PropIR[]
  navs: string[]
  description?: string
}
export interface EnumIR {
  name: string
  members: string[]
  flags: boolean
}
export interface SetIR {
  name: string
  type: string
  description?: string
  filterable: boolean
  nonFilterable: string[]
}
export interface AuthIR {
  kind: 'oauth2' | 'basic' | 'bearer' | 'apiKeyHeader' | 'apiKeyQuery' | 'other'
  name?: string
}
export interface SchemaIR {
  namespace: string
  alias?: string
  entityTypes: EntityTypeIR[]
  complexTypes: string[]
  enums: EnumIR[]
  typeDefs: { name: string; underlying: string }[]
  actions: string[]
  functions: string[]
  containers: { name: string; sets: SetIR[]; singletons: string[]; auth: AuthIR[] }[]
  annotationsIgnored: number
  externalAnnotations: number
}
export interface DocIR {
  format: 'csdl-json' | 'edmx-xml'
  version: string
  schemas: SchemaIR[]
  references: number
  /** Qualified name of the default container (CSDL JSON `$EntityContainer`), when the document names one. */
  containerName?: string
  /** Alias to namespace, from the references' includes (used to resolve vocabulary aliases in annotation terms). */
  aliases: Map<string, string>
}
export type ReadResult = { doc: DocIR; gaps: Gap[] } | { rejected: Gap[] }

export const MAX_ENTITY_TYPES = 500
export const MAX_MEMBERS = 5000
const clip = (s: unknown, n = 256): string => (typeof s === 'string' ? s.slice(0, n) : '')
const V4 = /^4\.\d{1,2}$/

export const TERM_DESCRIPTION = 'Org.OData.Core.V1.Description'
export const TERM_FILTER = 'Org.OData.Capabilities.V1.FilterRestrictions'
export const TERM_AUTH = 'Org.OData.Authorization.V1.Authorizations'

function normTerm(raw: string, aliases: Map<string, string>): string {
  const noQualifier = raw.split('#')[0]
  const dot = noQualifier.lastIndexOf('.')
  if (dot < 0) return noQualifier
  const alias = noQualifier.slice(0, dot)
  const ns = aliases.get(alias)
  return ns ? `${ns}${noQualifier.slice(dot)}` : noQualifier
}

export function versionUnsupported(detail: string): ReadResult {
  return {
    rejected: [gap('odata-version-unsupported', `${detail} Only OData 4.0 and 4.01 metadata (CSDL JSON or EDMX XML) is read; OData V2 and V3 metadata is not supported.`, { severity: 'error' })],
  }
}

function authKind(typeName: string, scheme: string | undefined, location: string | undefined, keyName: string | undefined): AuthIR {
  const t = typeName.replace(/^#/, '')
  if (/\.(OAuth2\w*|OpenIDConnect)$/.test(t)) return { kind: 'oauth2' }
  if (/\.Http$/.test(t)) {
    const s = (scheme ?? '').toLowerCase()
    return { kind: s === 'basic' ? 'basic' : s === 'bearer' ? 'bearer' : 'other' }
  }
  if (/\.ApiKey$/.test(t)) {
    const nameOk = keyName && /^[A-Za-z0-9_-]{1,64}$/.test(keyName)
    if (nameOk && location === 'Header') return { kind: 'apiKeyHeader', name: keyName }
    if (nameOk && location === 'QueryOption') return { kind: 'apiKeyQuery', name: keyName }
  }
  return { kind: 'other' }
}

// ---------------------------------------------------------------------------------------------- CSDL JSON

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const members = (o: Obj) => Object.keys(o).filter((k) => !k.startsWith('$') && !k.startsWith('@'))

function jsonAnnotations(el: Obj, aliases: Map<string, string>): { description?: string; filter?: { filterable: boolean; non: string[] }; auth: AuthIR[]; other: number } {
  const out: { description?: string; filter?: { filterable: boolean; non: string[] }; auth: AuthIR[]; other: number } = { auth: [], other: 0 }
  for (const key of Object.keys(el)) {
    if (!key.startsWith('@')) continue
    const term = normTerm(key.slice(1), aliases)
    const v = el[key]
    if (term === TERM_DESCRIPTION && typeof v === 'string') out.description = clip(v, 2000)
    else if (term === TERM_FILTER && isObj(v)) {
      const non = Array.isArray(v.NonFilterableProperties) ? v.NonFilterableProperties.filter((x): x is string => typeof x === 'string').map((x) => clip(x)) : []
      out.filter = { filterable: v.Filterable !== false, non }
    } else if (term === TERM_AUTH && Array.isArray(v)) {
      for (const a of v.slice(0, 20)) {
        if (isObj(a)) out.auth.push(authKind(clip(a['@type']), typeof a.Scheme === 'string' ? a.Scheme : undefined, typeof a.Location === 'string' ? a.Location : undefined, typeof a.KeyName === 'string' ? a.KeyName : undefined))
      }
    } else out.other++
  }
  return out
}

export function readCsdlJson(root: Obj): ReadResult {
  const version = root.$Version
  if (typeof version !== 'string' || !V4.test(version)) return versionUnsupported('The document declares no OData 4.x $Version.')
  const gaps: Gap[] = []
  const aliases = new Map<string, string>()
  let references = 0
  if (isObj(root.$Reference)) {
    for (const uri of Object.keys(root.$Reference).slice(0, 100)) {
      references++
      const ref = (root.$Reference as Obj)[uri]
      if (isObj(ref) && Array.isArray(ref.$Include)) {
        for (const inc of ref.$Include.slice(0, 100)) if (isObj(inc) && typeof inc.$Alias === 'string' && typeof inc.$Namespace === 'string') aliases.set(clip(inc.$Alias, 64), clip(inc.$Namespace))
      }
    }
  }
  const schemas: SchemaIR[] = []
  let typeCount = 0
  let memberCount = 0
  for (const ns of Object.keys(root)) {
    if (ns.startsWith('$') || ns.startsWith('@')) continue
    const sch = root[ns]
    if (!isObj(sch)) continue
    const ir: SchemaIR = { namespace: clip(ns), alias: typeof sch.$Alias === 'string' ? clip(sch.$Alias, 64) : undefined, entityTypes: [], complexTypes: [], enums: [], typeDefs: [], actions: [], functions: [], containers: [], annotationsIgnored: 0, externalAnnotations: 0 }
    if (isObj(sch.$Annotations)) ir.externalAnnotations += Object.keys(sch.$Annotations).length
    ir.annotationsIgnored += Object.keys(sch).filter((k) => k.startsWith('@')).length
    for (const name of members(sch)) {
      if (++memberCount > MAX_MEMBERS) return { rejected: [gap('odata-too-large', `The metadata declares more than ${MAX_MEMBERS} schema members.`, { severity: 'error' })] }
      const el = sch[name]
      if (Array.isArray(el)) {
        const first = el.find(isObj)
        if (first?.$Kind === 'Action') ir.actions.push(clip(name))
        else if (first?.$Kind === 'Function') ir.functions.push(clip(name))
        continue
      }
      if (!isObj(el)) continue
      const kind = el.$Kind
      if (kind === 'EntityType') {
        if (++typeCount > MAX_ENTITY_TYPES) return { rejected: [gap('odata-too-large', `The metadata declares more than ${MAX_ENTITY_TYPES} entity types.`, { severity: 'error' })] }
        const ann = jsonAnnotations(el, aliases)
        ir.annotationsIgnored += ann.other
        const key: string[] = []
        let keyUnsupported = false
        if (Array.isArray(el.$Key)) {
          for (const k of el.$Key.slice(0, 20)) {
            if (typeof k === 'string') key.push(clip(k))
            else keyUnsupported = true
          }
        }
        const props: PropIR[] = []
        const navs: string[] = []
        for (const pn of members(el)) {
          if (++memberCount > MAX_MEMBERS) return { rejected: [gap('odata-too-large', `The metadata declares more than ${MAX_MEMBERS} schema members.`, { severity: 'error' })] }
          const p = el[pn]
          if (!isObj(p)) continue
          if (p.$Kind === 'NavigationProperty') navs.push(clip(pn))
          else props.push({ name: clip(pn), type: typeof p.$Type === 'string' ? clip(p.$Type) : 'Edm.String', collection: p.$Collection === true })
        }
        ir.entityTypes.push({ name: clip(name), base: typeof el.$BaseType === 'string' ? clip(el.$BaseType) : undefined, abstract: el.$Abstract === true, open: el.$OpenType === true, key, keyUnsupported, props, navs, description: ann.description })
      } else if (kind === 'ComplexType') ir.complexTypes.push(clip(name))
      else if (kind === 'EnumType') ir.enums.push({ name: clip(name), members: members(el).slice(0, 500).map((m) => clip(m)), flags: el.$IsFlags === true })
      else if (kind === 'TypeDefinition') ir.typeDefs.push({ name: clip(name), underlying: typeof el.$UnderlyingType === 'string' ? clip(el.$UnderlyingType) : 'Edm.String' })
      else if (kind === 'EntityContainer') {
        const cann = jsonAnnotations(el, aliases)
        ir.annotationsIgnored += cann.other
        const sets: SetIR[] = []
        const singletons: string[] = []
        for (const cn of members(el)) {
          const c = el[cn]
          if (!isObj(c)) continue
          if (c.$Collection === true && typeof c.$Type === 'string') {
            const a = jsonAnnotations(c, aliases)
            ir.annotationsIgnored += a.other
            sets.push({ name: clip(cn), type: clip(c.$Type), description: a.description, filterable: a.filter ? a.filter.filterable : true, nonFilterable: a.filter?.non ?? [] })
          } else if (typeof c.$Type === 'string') singletons.push(clip(cn))
        }
        ir.containers.push({ name: clip(name), sets, singletons, auth: cann.auth })
      }
    }
    schemas.push(ir)
  }
  const containerName = typeof root.$EntityContainer === 'string' ? clip(root.$EntityContainer) : undefined
  return { doc: { format: 'csdl-json', version, schemas, references, containerName, aliases }, gaps }
}

// -------------------------------------------------------------------------------------------------- EDMX XML

const NS_EDMX4 = 'http://docs.oasis-open.org/odata/ns/edmx'
const NS_EDM4 = 'http://docs.oasis-open.org/odata/ns/edm'
const NS_EDMX_OLD = 'http://schemas.microsoft.com/ado/2007/06/edmx'
const OLD_EDM = /^http:\/\/schemas\.microsoft\.com\/ado\/(2006\/04|2007\/05|2008\/09|2009\/11)\/edm$/

/** True when the XML root is an Edmx element of any known namespace (the adapter then answers, even for V1 to V3). */
export function isEdmxRoot(root: XNode): boolean {
  return root.name === 'Edmx' && (root.ns === NS_EDMX4 || root.ns === NS_EDMX_OLD)
}

const child = (n: XNode, name: string) => n.children.filter((c) => c.name === name)
const textOf = (n: XNode) => n.text.trim()

function xmlAnnotations(el: XNode, aliases: Map<string, string>): { description?: string; filter?: { filterable: boolean; non: string[] }; auth: AuthIR[]; other: number } {
  const out: { description?: string; filter?: { filterable: boolean; non: string[] }; auth: AuthIR[]; other: number } = { auth: [], other: 0 }
  for (const a of child(el, 'Annotation')) {
    const term = normTerm(a.attrs.Term ?? '', aliases)
    if (term === TERM_DESCRIPTION) {
      const s = a.attrs.String ?? textOf(child(a, 'String')[0] ?? { text: '' } as XNode)
      if (s) out.description = clip(s, 2000)
    } else if (term === TERM_FILTER) {
      const rec = child(a, 'Record')[0]
      let filterable = true
      const non: string[] = []
      for (const pv of rec ? child(rec, 'PropertyValue') : []) {
        if (pv.attrs.Property === 'Filterable' && pv.attrs.Bool === 'false') filterable = false
        if (pv.attrs.Property === 'NonFilterableProperties') for (const col of child(pv, 'Collection')) for (const pp of child(col, 'PropertyPath').slice(0, 500)) non.push(clip(textOf(pp)))
      }
      out.filter = { filterable, non }
    } else if (term === TERM_AUTH) {
      for (const col of child(a, 'Collection')) {
        for (const rec of child(col, 'Record').slice(0, 20)) {
          const pv = (name: string) => child(rec, 'PropertyValue').find((p) => p.attrs.Property === name)?.attrs.String
          out.auth.push(authKind(clip(rec.attrs.Type), pv('Scheme'), pv('Location'), pv('KeyName')))
        }
      }
    } else out.other++
  }
  return out
}

export function readEdmx(root: XNode): ReadResult {
  if (root.name !== 'Edmx') return { rejected: [gap('odata-not-edmx', 'The XML root is not an Edmx element.', { severity: 'error' })] }
  if (root.ns === NS_EDMX_OLD) return versionUnsupported('The document is an OData V1, V2 or V3 EDMX document.')
  if (root.ns !== NS_EDMX4) return { rejected: [gap('odata-not-edmx', 'The XML root is not an OData EDMX element.', { severity: 'error' })] }
  const version = root.attrs.Version ?? ''
  if (!V4.test(version)) return versionUnsupported('The EDMX document does not declare Version 4.0 or 4.01.')
  const aliases = new Map<string, string>()
  let references = 0
  for (const ref of child(root, 'Reference').slice(0, 100)) {
    references++
    for (const inc of child(ref, 'Include').slice(0, 100)) if (inc.attrs.Alias && inc.attrs.Namespace) aliases.set(clip(inc.attrs.Alias, 64), clip(inc.attrs.Namespace))
  }
  const gaps: Gap[] = []
  const schemas: SchemaIR[] = []
  let typeCount = 0
  let memberCount = 0
  const over = (what: string, max: number): ReadResult => ({ rejected: [gap('odata-too-large', `The metadata declares more than ${max} ${what}.`, { severity: 'error' })] })
  for (const ds of child(root, 'DataServices')) {
    for (const sch of child(ds, 'Schema')) {
      if (sch.ns !== NS_EDM4) {
        if (OLD_EDM.test(sch.ns)) return versionUnsupported('A schema uses an OData V1, V2 or V3 namespace.')
        gaps.push(gap('odata-schema-skipped', 'A Schema element in an unknown namespace was skipped.', { severity: 'warn' }))
        continue
      }
      const ir: SchemaIR = { namespace: clip(sch.attrs.Namespace), alias: sch.attrs.Alias ? clip(sch.attrs.Alias, 64) : undefined, entityTypes: [], complexTypes: [], enums: [], typeDefs: [], actions: [], functions: [], containers: [], annotationsIgnored: 0, externalAnnotations: 0 }
      for (const el of sch.children) {
        if (++memberCount > MAX_MEMBERS) return over('schema members', MAX_MEMBERS)
        switch (el.name) {
          case 'EntityType': {
            if (++typeCount > MAX_ENTITY_TYPES) return over('entity types', MAX_ENTITY_TYPES)
            const ann = xmlAnnotations(el, aliases)
            ir.annotationsIgnored += ann.other
            const key: string[] = []
            let keyUnsupported = false
            for (const k of child(el, 'Key').slice(0, 1)) for (const ref of child(k, 'PropertyRef').slice(0, 20)) {
              if (ref.attrs.Alias) keyUnsupported = true
              else key.push(clip(ref.attrs.Name))
            }
            const props: PropIR[] = []
            for (const p of child(el, 'Property')) {
              if (++memberCount > MAX_MEMBERS) return over('schema members', MAX_MEMBERS)
              let type = clip(p.attrs.Type) || 'Edm.String'
              let collection = false
              const m = /^Collection\((.*)\)$/.exec(type)
              if (m) {
                collection = true
                type = m[1]
              }
              props.push({ name: clip(p.attrs.Name), type, collection })
            }
            ir.entityTypes.push({ name: clip(el.attrs.Name), base: el.attrs.BaseType ? clip(el.attrs.BaseType) : undefined, abstract: el.attrs.Abstract === 'true', open: el.attrs.OpenType === 'true', key, keyUnsupported, props, navs: child(el, 'NavigationProperty').map((n) => clip(n.attrs.Name)), description: ann.description })
            break
          }
          case 'ComplexType':
            ir.complexTypes.push(clip(el.attrs.Name))
            break
          case 'EnumType':
            ir.enums.push({ name: clip(el.attrs.Name), members: child(el, 'Member').slice(0, 500).map((m) => clip(m.attrs.Name)), flags: el.attrs.IsFlags === 'true' })
            break
          case 'TypeDefinition':
            ir.typeDefs.push({ name: clip(el.attrs.Name), underlying: clip(el.attrs.UnderlyingType) || 'Edm.String' })
            break
          case 'Action':
            ir.actions.push(clip(el.attrs.Name))
            break
          case 'Function':
            ir.functions.push(clip(el.attrs.Name))
            break
          case 'Annotations':
            ir.externalAnnotations++
            break
          case 'Annotation':
          case 'Term':
            ir.annotationsIgnored++
            break
          case 'EntityContainer': {
            const cann = xmlAnnotations(el, aliases)
            ir.annotationsIgnored += cann.other
            const sets: SetIR[] = []
            for (const s of child(el, 'EntitySet')) {
              const a = xmlAnnotations(s, aliases)
              ir.annotationsIgnored += a.other
              sets.push({ name: clip(s.attrs.Name), type: clip(s.attrs.EntityType), description: a.description, filterable: a.filter ? a.filter.filterable : true, nonFilterable: a.filter?.non ?? [] })
            }
            ir.containers.push({ name: clip(el.attrs.Name), sets, singletons: child(el, 'Singleton').map((s) => clip(s.attrs.Name)), auth: cann.auth })
            break
          }
          default:
            break
        }
      }
      schemas.push(ir)
    }
  }
  return { doc: { format: 'edmx-xml', version, schemas, references, aliases }, gaps }
}
