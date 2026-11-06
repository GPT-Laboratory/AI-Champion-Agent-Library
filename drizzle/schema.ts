// SOURCE: Drizzle ORM SQLite docs (orm.drizzle.team/docs/get-started-sqlite)
// Maps AgentRecord fields to SQLite columns for the agents catalog table.
import { sqliteTable, text, integer, real, blob } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const agents = sqliteTable('agents', {
  slug:                  text('slug').primaryKey(),
  title:                 text('title').notNull(),
  summary:               text('summary').notNull().default(''),
  systemPrompt:          text('system_prompt').notNull(),
  llmName:               text('llm_name').notNull(),
  llmTemperature:        real('llm_temperature'),
  llmMaxTokens:          integer('llm_max_tokens'),
  llmTopP:               real('llm_top_p'),
  toolNames:             text('tool_names').notNull().default('[]'),  // JSON-serialized string[]
  inputSchema:           text('input_schema').notNull().default('[]'), // JSON-serialized AgentInputField[]
  requiresHumanApproval: integer('requires_human_approval', { mode: 'boolean' }).notNull().default(false),
  category:              text('category'),
  githubUrl:             text('github_url'),
  linkLabel:             text('link_label'),
  maturityStatus:        text('maturity_status').notNull().default('experimental'),
  tags:                  text('tags').notNull().default('[]'),        // JSON-serialized string[]
  customizableFields:    text('customizable_fields'),               // JSON-serialized string[]; null = all fields
  fixedNote:             text('fixed_note'),
  fixedFields:           text('fixed_fields').notNull().default('[]'), // JSON-serialized string[]
  specId:                text('spec_id'),
  tryItOutMode:          text('try_it_out_mode').notNull().default('none'),  // allowed values: none | external | runnable
  tryItOutUrl:           text('try_it_out_url'),
  tryItOutTaskTemplate:  text('try_it_out_task_template'),
  lastIngestedAt:        text('last_ingested_at').notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
})

export type AgentRow = typeof agents.$inferSelect
export type NewAgentRow = typeof agents.$inferInsert

export const agentEmbeddings = sqliteTable('agent_embeddings', {
  slug:        text('slug').primaryKey().references(() => agents.slug, { onDelete: 'cascade' }),
  model:       text('model').notNull(),
  contentHash: text('content_hash').notNull(),
  vector:      blob('vector', { mode: 'buffer' }).notNull(),
  updatedAt:   text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
})
export type AgentEmbeddingRow = typeof agentEmbeddings.$inferSelect

// Phase 13 (flag AGENT_KINDS): additive sidecar for agent kind data. `agents` is untouched.
// Keep in sync with AGENT_KINDS_DDL in src/lib/spec/kinds-ddl.ts (guarded by a test).
export const agentKinds = sqliteTable('agent_kinds', {
  slug:         text('slug').primaryKey().references(() => agents.slug, { onDelete: 'cascade' }),
  kind:         text('kind').notNull().default('agent'),
  framework:    text('framework'),
  topology:     text('topology'),
  members:      text('members').notNull().default('[]'),   // JSON-serialized AgentMember[]
  sourceFormat: text('source_format'),
  extras:       text('extras').notNull().default('{}'),    // JSON object, capped
  updatedAt:    text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
})
export type AgentKindRow = typeof agentKinds.$inferSelect
