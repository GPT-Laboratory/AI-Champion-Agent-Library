import { readdir, readFile, mkdir, lstat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq, sql } from 'drizzle-orm'
import { parse as parseYaml } from 'yaml'
import { agents, agentEmbeddings, agentKinds } from '../drizzle/schema.js'
import type { NewAgentRow } from '../drizzle/schema.js'
import { detectFormat, normalize } from '../src/lib/spec/index.js'
import type { AgentRecord } from '../src/lib/spec/types.js'
import { buildSearchText, contentHash, recordToSearchable, recordToSearchableWithKind } from '../src/lib/server/search/documents.js'
import type { Searchable } from '../src/lib/server/search/documents.js'
import { EMBEDDING_DIM, createTransformersEmbedder, vectorToBlob } from '../src/lib/server/search/embedder.js'
import type { Embedder } from '../src/lib/server/search/embedder.js'
import { agentKindsEnabled, localMcpAgentsEnabled } from '../src/lib/flags.js'
import { LOCAL_MCP_SLUGS } from '../src/lib/localMcp/slugs.js'
import { ensureAgentKindsTable } from '../src/lib/spec/kinds-ddl.js'
import { clampExtras } from '../src/lib/spec/kinds.js'
import type { SubmissionFile } from '../src/lib/spec/kinds.js'
import { parseSubmission } from '../src/lib/spec/registry.js'
import { readSubmissionDir } from '../src/lib/spec/scan.js'
import { redactSecrets, sanitizeMessage } from '../src/lib/spec/security.js'
import { isMainModule } from './is-main.js'

const DATA_DIR = process.env.INGEST_DATA_DIR ?? './data/agents'
const DB_PATH = process.env.INGEST_DB_PATH ?? './db/catalog.db'

/** Texts per embedder call: bounds padding and peak memory on large catalogs. */
export const EMBED_BATCH_SIZE = 16

function isValidVector(v: unknown): v is Float32Array {
  if (!(v instanceof Float32Array) || v.length !== EMBEDDING_DIM) return false
  for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) return false
  return true
}

function flattenRecord(record: AgentRecord): NewAgentRow {
  return {
    slug: record.slug,
    title: record.title,
    summary: record.summary,
    systemPrompt: record.systemPrompt,
    llmName: record.llm.name,
    llmTemperature: record.llm.temperature,
    llmMaxTokens: record.llm.maxTokens,
    llmTopP: record.llm.topP,
    toolNames: JSON.stringify(record.toolNames),
    inputSchema: JSON.stringify(record.inputFields),
    requiresHumanApproval: record.requiresHumanApproval,
    category: record.category,
    githubUrl: record.githubUrl,
    linkLabel: record.linkLabel,
    maturityStatus: record.maturityStatus,
    tags: JSON.stringify(record.tags),
    customizableFields: record.customizableFields ? JSON.stringify(record.customizableFields) : null,
    fixedFields: JSON.stringify(record.fixedFields),
    fixedNote: record.fixedNote,
    specId: record.specId,
    // try_it_out_* mirror the drizzle/schema.ts column defaults and are
    // intentionally NOT read from AgentRecord (D-05/D-06) — try_it_out is
    // not sourced from Oracle AgentSpec YAML in this phase; the DB row is
    // the system of record.
    tryItOutMode: 'none',
    tryItOutUrl: null,
    tryItOutTaskTemplate: null,
    lastIngestedAt: new Date().toISOString(),
  }
}

type Db = ReturnType<typeof drizzle>

// Embedding step: never throws, never changes ingest counts.
async function embedAgents(
  sqlite: Database.Database,
  db: Db,
  searchables: Searchable[],
  opts?: { embedder?: Embedder | null },
): Promise<void> {
  try {
    const hasTable = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_embeddings'`)
      .get()
    if (!hasTable) {
      console.warn('[search] agent_embeddings table missing; run db:push (semantic search stays off)')
      return
    }

    let embedder: Embedder | null
    if (opts?.embedder !== undefined) {
      embedder = opts.embedder
      if (!embedder) console.warn('[search] no embedder available; skipping embeddings (BM25-only)')
    } else if (process.env.SEARCH_EMBEDDINGS === 'off') {
      return
    } else {
      embedder = await createTransformersEmbedder()
      if (!embedder) console.warn('[search] no embedder available; skipping embeddings (BM25-only)')
    }
    if (!embedder) return

    const existing = new Map<string, { model: string; hash: string }>()
    for (const r of sqlite
      .prepare('SELECT slug, model, content_hash FROM agent_embeddings')
      .all() as { slug: string; model: string; content_hash: string }[]) {
      existing.set(r.slug, { model: r.model, hash: r.content_hash })
    }

    const unique = new Map<string, Searchable>()
    for (const s of searchables) unique.set(s.slug, s)

    const stale: { slug: string; text: string; hash: string }[] = []
    for (const s of unique.values()) {
      const text = buildSearchText(s)
      const hash = contentHash(embedder.id, text)
      const prev = existing.get(s.slug)
      if (!prev || prev.model !== embedder.id || prev.hash !== hash) {
        stale.push({ slug: s.slug, text, hash })
      }
    }

    if (stale.length > 0) {
      let written = 0
      let failed = 0
      for (let start = 0; start < stale.length; start += EMBED_BATCH_SIZE) {
        const batch = stale.slice(start, start + EMBED_BATCH_SIZE)
        let vectors: Float32Array[]
        try {
          vectors = await embedder.embed(batch.map(x => x.text))
        } catch (err) {
          console.warn(`[search] embedding batch failed: ${(err as Error).message}`)
          failed += batch.length
          continue
        }
        // Without a 1:1 count the vectors cannot be matched to rows: reject the whole batch.
        if (!Array.isArray(vectors) || vectors.length !== batch.length) {
          console.warn(
            `[search] embedder returned ${Array.isArray(vectors) ? vectors.length : 'no'} vectors for ${batch.length} texts; batch skipped`,
          )
          failed += batch.length
          continue
        }
        const rows: (typeof agentEmbeddings.$inferInsert)[] = []
        batch.forEach((item, k) => {
          const v = vectors[k]
          if (!isValidVector(v)) {
            console.warn(`[search] invalid embedding for ${item.slug} (expected ${EMBEDDING_DIM} finite floats); skipped`)
            failed++
            return
          }
          rows.push({
            slug: item.slug,
            model: embedder.id,
            contentHash: item.hash,
            vector: vectorToBlob(v),
            updatedAt: new Date().toISOString(),
          })
        })
        if (rows.length === 0) continue
        try {
          // One transaction per batch: a batch is written entirely or not at all.
          db.transaction(tx => {
            for (const row of rows) {
              tx.insert(agentEmbeddings)
                .values(row)
                .onConflictDoUpdate({
                  target: agentEmbeddings.slug,
                  set: {
                    model: sql`excluded.model`,
                    contentHash: sql`excluded.content_hash`,
                    vector: sql`excluded.vector`,
                    updatedAt: sql`excluded.updated_at`,
                  },
                })
                .run()
            }
          })
          written += rows.length
        } catch (err) {
          console.warn(`[search] writing embeddings failed: ${(err as Error).message}`)
          failed += rows.length
        }
      }
      console.log(`[search] embeddings: ${written} written, ${failed} failed`)
    }

    sqlite.prepare('DELETE FROM agent_embeddings WHERE slug NOT IN (SELECT slug FROM agents)').run()
  } catch (err) {
    console.warn(`[search] embedding step failed: ${(err as Error).message}`)
  }
}

async function ingest( dataDir: string, dbPath: string, opts?: { embedder?: Embedder | null }): Promise<{ succeeded: number; failed: number }> {
  await mkdir(dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)
  try {
    return await ingestInto(sqlite, dataDir, opts)
  } finally {
    // Always release the handle, including when readdir/readFile throw.
    sqlite.close()
  }
}

/**
 * CR-02: a re-ingest may land on a slug owned by a different kind or source format (an unrelated
 * submission with the same derived slug, or an author changing what the folder contains). The
 * upsert deliberately keeps try_it_out_* (D-07), so in that case they are reset to the defaults
 * instead of letting a new skill/system inherit a previous agent's runnable or external setting.
 * A legacy row with no sidecar counts as kind 'agent' and is NOT compared by source format, so
 * turning the flag on never resets curated settings.
 */
export function tryItOutResetReason(
  sqlite: Database.Database,
  slug: string,
  next: { kind: string; sourceFormat: string | null },
): string | null {
  const prev = sqlite
    .prepare(
      'SELECT k.slug AS sidecar, k.kind AS kind, k.source_format AS source_format FROM agents a LEFT JOIN agent_kinds k ON k.slug = a.slug WHERE a.slug = ?',
    )
    .get(slug) as { sidecar: string | null; kind: string | null; source_format: string | null } | undefined
  if (!prev) return null
  const prevKind = prev.kind ?? 'agent'
  if (prevKind !== next.kind) return `kind ${prevKind} -> ${next.kind}`
  if (prev.sidecar !== null) {
    const family = (f: string | null) => (f ?? '').split('@')[0]
    if (family(prev.source_format) !== family(next.sourceFormat)) {
      return `source format ${prev.source_format ?? 'none'} -> ${next.sourceFormat ?? 'none'}`
    }
  }
  return null
}

/** Flag-on ingest never treats a directory with one of these names as a submission or part of one (D-466). */
const INGEST_SKIP_DIR_NAMES: readonly string[] = ['fixtures']

/**
 * Flag-on (AGENT_KINDS) ingest, kept separate so the legacy path stays untouched.
 * Top-level files are single submissions; sub-directories are scanned as submissions;
 * unrecognized directories are skipped with an info log (not counted as failures).
 */

async function ingestKindsInto(
  sqlite: Database.Database,
  db: Db,
  dataDir: string,
  opts?: { embedder?: Embedder | null },
): Promise<{ succeeded: number; failed: number }> {
  ensureAgentKindsTable(sqlite)
  const entries = (await readdir(dataDir)).sort()
  let succeeded = 0
  let failed = 0
  const searchables: Searchable[] = []
  const seen = new Set<string>()
  const now = new Date().toISOString()

  for (const name of entries) {
    const abs = join(dataDir, name)
    let files: SubmissionFile[]
    let isDir = false
    try {
      // WR-04: lstat, not stat. Symlinks are never followed (same policy as the directory scanner).
      const st = await lstat(abs)
      const isDataFile = name.endsWith('.yaml') || name.endsWith('.yml') || name.endsWith('.json')
      if (st.isSymbolicLink()) {
        if (name.startsWith('.') || name === 'node_modules' || !(isDataFile || !name.includes('.'))) continue
        throw new Error('symlinks are not followed')
      } else if (st.isDirectory()) {
        if (name.startsWith('.') || name === 'node_modules') continue
        // D-466: with AGENT_KINDS on, directories named `fixtures` (any depth) are test data, never submissions.
        if (INGEST_SKIP_DIR_NAMES.includes(name.toLowerCase())) {
          console.log(`[SKIP-INFO] ${name}: fixtures directory is not ingested`)
          continue
        }
        isDir = true
        files = readSubmissionDir(abs, { skipDirNames: INGEST_SKIP_DIR_NAMES }).files
      } else if (isDataFile) {
        // Single files go through the scanner too: size cap, binary check, no symlink.
        files = readSubmissionDir(abs).files
        if (files.length === 0) throw new Error('file skipped: too large, binary or unreadable')
      } else {
        continue
      }
    } catch (err) {
      console.error(`[SKIP] ${name}: ${sanitizeMessage((err as Error).message)}`)
      failed++
      continue
    }

    try {
      const hint = isDir ? name : name.replace(/\.[^.]+$/, '')
      const outcome = parseSubmission(files, { now, hint })
      if (!outcome.record) {
        // WR-01: only a folder in which NO format was detected (and nothing went wrong) is
        // skipped quietly. A recognised-but-broken submission is a failure with its reason.
        if (isDir && outcome.format === 'unknown' && outcome.warnings.length === 0) {
          console.log(`[SKIP-INFO] ${name}: not a recognized submission`)
          continue
        }
        const why = [
          outcome.missingFromAuthor.length > 0 ? `missing: ${outcome.missingFromAuthor.join(', ')}` : '',
          ...outcome.warnings,
        ].filter(Boolean)
        throw new Error(`${outcome.format}: ${why.join('; ') || `unrecognized or invalid (${outcome.status})`}`)
      }
      const record = outcome.record
      const info = outcome.kindInfo
      if (!info) throw new Error('adapter returned a record without kind info')
      if (seen.has(record.slug)) throw new Error(`duplicate slug '${record.slug}' in this run`)
      const row = flattenRecord(record)
      const extras = JSON.stringify(clampExtras(redactSecrets(info.extras) as Record<string, unknown>))
      const updatedAt = new Date().toISOString()
      const resetReason = tryItOutResetReason(sqlite, record.slug, info)
      if (resetReason) {
        console.warn(`[WARN] ${name}: slug '${record.slug}' already existed (${resetReason}); try-it-out settings reset`)
      }

      db.transaction(tx => {
        tx.insert(agents)
          .values(row)
          .onConflictDoUpdate({
            target: agents.slug,
            set: {
              title: sql`excluded.title`,
              summary: sql`excluded.summary`,
              systemPrompt: sql`excluded.system_prompt`,
              llmName: sql`excluded.llm_name`,
              llmTemperature: sql`excluded.llm_temperature`,
              llmMaxTokens: sql`excluded.llm_max_tokens`,
              llmTopP: sql`excluded.llm_top_p`,
              toolNames: sql`excluded.tool_names`,
              inputSchema: sql`excluded.input_schema`,
              requiresHumanApproval: sql`excluded.requires_human_approval`,
              category: sql`excluded.category`,
              githubUrl: sql`excluded.github_url`,
              linkLabel: sql`excluded.link_label`,
              maturityStatus: sql`excluded.maturity_status`,
              tags: sql`excluded.tags`,
              customizableFields: sql`excluded.customizable_fields`,
              fixedFields: sql`excluded.fixed_fields`,
              fixedNote: sql`excluded.fixed_note`,
              specId: sql`excluded.spec_id`,
              // try_it_out_* omitted on purpose (D-07): the DB is the system of record.
              lastIngestedAt: sql`excluded.last_ingested_at`,
            },
          })
          .run()
        if (resetReason) {
          tx.update(agents)
            .set({ tryItOutMode: 'none', tryItOutUrl: null, tryItOutTaskTemplate: null })
            .where(eq(agents.slug, record.slug))
            .run()
        }
        tx.insert(agentKinds)
          .values({
            slug: record.slug,
            kind: info.kind,
            framework: info.framework,
            topology: info.topology,
            members: JSON.stringify(info.members),
            sourceFormat: info.sourceFormat,
            extras,
            updatedAt,
          })
          .onConflictDoUpdate({
            target: agentKinds.slug,
            set: {
              kind: sql`excluded.kind`,
              framework: sql`excluded.framework`,
              topology: sql`excluded.topology`,
              members: sql`excluded.members`,
              sourceFormat: sql`excluded.source_format`,
              extras: sql`excluded.extras`,
              updatedAt: sql`excluded.updated_at`,
            },
          })
          .run()
      })

      seen.add(record.slug)
      searchables.push(recordToSearchableWithKind(record, { ...info, extras: {} }))
      succeeded++
    } catch (err) {
      console.error(`[SKIP] ${name}: ${sanitizeMessage((err as Error).message)}`)
      failed++
    }
  }

  sqlite.prepare('DELETE FROM agent_kinds WHERE slug NOT IN (SELECT slug FROM agents)').run()
  await embedAgents(sqlite, db, searchables, opts)
  console.log(`Ingestion complete: ${succeeded} succeeded, ${failed} failed`)
  return { succeeded, failed }
}

async function ingestInto(sqlite: Database.Database, dataDir: string, opts?: { embedder?: Embedder | null }): Promise<{ succeeded: number; failed: number }> {
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle(sqlite)

  if (agentKindsEnabled()) return ingestKindsInto(sqlite, db, dataDir, opts)

  const files = (await readdir(dataDir)).filter(
    f => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json')
  )

  let succeeded = 0
  let failed = 0
  const searchables: Searchable[] = []

  for (const file of files) {
    const content = await readFile(join(dataDir, file), 'utf-8')
    try {
      const raw = parseYaml(content)
      const formatId = detectFormat(raw)
      const record = normalize(formatId, raw)
      const row = flattenRecord(record)

      await db
        .insert(agents)
        .values(row)
        .onConflictDoUpdate({
          target: agents.slug,
          set: {
            title: sql`excluded.title`,
            summary: sql`excluded.summary`,
            systemPrompt: sql`excluded.system_prompt`,
            llmName: sql`excluded.llm_name`,
            llmTemperature: sql`excluded.llm_temperature`,
            llmMaxTokens: sql`excluded.llm_max_tokens`,
            llmTopP: sql`excluded.llm_top_p`,
            toolNames: sql`excluded.tool_names`,
            inputSchema: sql`excluded.input_schema`,
            requiresHumanApproval: sql`excluded.requires_human_approval`,
            category: sql`excluded.category`,
            githubUrl: sql`excluded.github_url`,
            linkLabel: sql`excluded.link_label`,
            maturityStatus: sql`excluded.maturity_status`,
            tags: sql`excluded.tags`,
            customizableFields: sql`excluded.customizable_fields`,
            fixedFields: sql`excluded.fixed_fields`,
            fixedNote: sql`excluded.fixed_note`,
            specId: sql`excluded.spec_id`,
            // tryItOutMode / tryItOutUrl / tryItOutTaskTemplate are
            // deliberately OMITTED from this set block (D-07): try_it_out
            // is not sourced from AgentSpec YAML, so the DB is the system
            // of record for it. Re-ingestion must never clobber a
            // manually-set value. Every other column above keeps updating
            // from excluded.* as before — do not "fix" this omission.
            lastIngestedAt: sql`excluded.last_ingested_at`,
          },
        })

      searchables.push(recordToSearchable(record))
      succeeded++
    } catch (err) {
      console.error(`[SKIP] ${file}: ${sanitizeMessage((err as Error).message)}`)
      failed++
    }
  }

  await embedAgents(sqlite, db, searchables, opts)

  console.log(`Ingestion complete: ${succeeded} succeeded, ${failed} failed`)

  return { succeeded, failed }
}

export { ingest }

const LOCAL_DIR = process.env.INGEST_LOCAL_DIR ?? './data/agents-local'

/**
 * D-637: with LOCAL_MCP_AGENTS off, delete the rows of the local-MCP slugs (an earlier flag-on ingest
 * may have left them). Never fails the ingest. Deletes nothing when the slugs are absent.
 */
function purgeLocalSlugs(dbPath: string): void {
  let sqlite: Database.Database | null = null
  try {
    if (!existsSync(dbPath)) return
    sqlite = new Database(dbPath)
    const has = (t: string) =>
      sqlite!.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(t) !== undefined
    const slugs = [...LOCAL_MCP_SLUGS]
    const marks = slugs.map(() => '?').join(',')
    const tx = sqlite.transaction(() => {
      for (const t of ['agent_kinds', 'agent_embeddings', 'agents']) {
        if (has(t)) sqlite!.prepare(`DELETE FROM ${t} WHERE slug IN (${marks})`).run(...slugs)
      }
    })
    tx()
  } catch (err) {
    console.error(`[purge] local-mcp purge skipped: ${sanitizeMessage((err as Error).message)}`)
  } finally {
    sqlite?.close()
  }
}

/** Main ingest plus, when LOCAL_MCP_AGENTS is on, the data/agents-local pass; off purges stale local rows. */
async function ingestAll(
  dataDir: string,
  dbPath: string,
  opts?: { embedder?: Embedder | null; localDir?: string },
): Promise<{ succeeded: number; failed: number }> {
  const { localDir = LOCAL_DIR, ...rest } = opts ?? {}
  const main = await ingest(dataDir, dbPath, rest)
  if (!localMcpAgentsEnabled()) {
    purgeLocalSlugs(dbPath)
    return main
  }
  if (!existsSync(localDir)) return main
  const local = await ingest(localDir, dbPath, rest)
  return { succeeded: main.succeeded + local.succeeded, failed: main.failed + local.failed }
}

export { ingestAll }

const isMain = isMainModule(import.meta.url, process.argv[1])
if (isMain) {
  ingestAll(DATA_DIR, DB_PATH).catch(err => {
    console.error(err)
    process.exit(1)
  })
}
