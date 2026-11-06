// Contracts for the MCP generator (design: docs/mcp-generator-design.md section 4).
import type { ProposalProvenance, ProposedBehavior } from './proposals/model.js'
export type Severity = 'error' | 'warn' | 'info'
export interface Gap {
  code: string
  message: string
  severity: Severity
  path?: string
}
export type FieldType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'unknown'
/** How a value is written as an OData URL literal (strings quoted and doubled, guid and date unquoted, enum members qualified). */
export type ODataKind = 'string' | 'guid' | 'date' | 'datetimeoffset' | 'timeofday' | 'number' | 'boolean' | 'enum'
export interface Field {
  name: string
  type: FieldType
  label?: string
  description?: string
  identifier?: boolean
  nameLike?: boolean
  classLike?: boolean
  nullable?: boolean
  enum?: string[]
  /** OData only: the literal kind used when the field is compiled into `$filter`, and whether it may be filtered at all. */
  odata?: { kind: ODataKind; filterable: boolean; enumType?: string }
}
export interface NestedCollection {
  field: string
  itemFields: Field[]
  keyFields: string[]
  valueFields: string[]
}
export interface Entity {
  id: string
  label: string
  fields: Field[]
  identifierFields: string[]
  nested: NestedCollection[]
}
export interface Param {
  name: string
  in: 'query' | 'path' | 'body' | 'column'
  type: FieldType
  required: boolean
  min?: number
  max?: number
  enum?: string[]
  description?: string
  /** The name on the wire when it differs from the tool argument name (OData `$top`, `$skip`, key property names). */
  wireName?: string
}
export interface Operation {
  id: string
  kind: 'list' | 'get' | 'search' | 'other'
  method: 'GET' | 'SELECT' | 'DATASET'
  path?: string
  /** 'odata' routes the operation to the OData templates (default: plain REST). `path` is then the entity set path. */
  protocol?: 'rest' | 'odata'
  entity: string
  params: Param[]
  pageParam?: string
  pageSizeParam?: string
  /** Integer offset parameter of an offset/limit paged operation (exposed as an argument). */
  offsetParam?: string
  summary?: string
}
export interface SourceModel {
  name: string
  backend: {
    kind: 'http' | 'dataset' | 'sql'
    baseUrlEnv?: string
    datasetPathEnv?: string
    dsnEnv?: string
    /** Field delimiter of a dataset file: a comma (default), semicolon or tab. */
    delimiter?: string
  }
  /** Names only, never values. */
  auth: {
    scheme: 'none' | 'apiKeyHeader' | 'apiKeyQuery' | 'bearer'
    paramName?: string
    envVar?: string
    /** The token comes from an OAuth2 or OpenID Connect scheme: a bearer access token the operator obtains (no flow runs). */
    oauth2?: boolean
  }
  entities: Entity[]
  operations: Operation[]
  limits: { maxPageSize?: number; resultCeiling?: number; maxResponseItems: number }
  gaps: Gap[]
  writeOperationsDropped: string[]
}
export interface GenerateOptions {
  allowWrite?: string[]
  limits?: Partial<SourceModel['limits']>
  projectionOverride?: Record<string, string[]>
  serverName?: string
}
export interface RawInput {
  text: string
  filename?: string
}
export type ParseResult = { model: SourceModel; gaps: Gap[] } | { rejected: Gap[] }
export interface InputAdapter {
  id: string
  label: string
  detect(input: RawInput): number
  parse(input: RawInput, options?: GenerateOptions): ParseResult
  /** Optional: load something asynchronously (a dynamically imported parser) before the synchronous `parse`. */
  prepare?(input: RawInput): Promise<void>
  /** Optional: the source text without parts that must not leave the process (SQL row data), for exports such as the context pack. */
  scrubSource?(text: string): { text: string; changed: boolean }
}
export interface DerivedTool {
  id: string
  kind: 'inMemoryFilter' | 'schemaDiscovery' | 'crossFieldSearch'
  entity: string
  source: string
  description: string
  origin: 'detected' | 'user' | 'proposed'
}
export interface PlannedTool {
  name: string
  description: string
  entity: string
  operation?: string
  derived?: DerivedTool
  params: Param[]
  projection: string[]
  /** Set only by an applied proposal set (docs/mcp-generator-proposals.md). */
  proposed?: ProposedBehavior
}
export interface ServerPlan {
  model: SourceModel
  tools: PlannedTool[]
  derived: DerivedTool[]
  gaps: Gap[]
  /** Tools emitted as private functions only: a proposal hid them or a merge, split or composite calls them. Never registered. */
  internal?: PlannedTool[]
  proposals?: ProposalProvenance
}
export interface GeneratedFile {
  path: string
  content: string
}
export interface GenerationReport {
  toolsEmitted: string[]
  toolsDropped: { id: string; reason: string }[]
  gaps: Gap[]
  assumptions: string[]
  envVars: { name: string; purpose: string }[]
  proposals?: ProposalProvenance
}
export interface GenerationResult {
  files: GeneratedFile[]
  report: GenerationReport
}
