// Additive DDL for the agent_kinds sidecar table (flag AGENT_KINDS). Idempotent.
// Columns must match drizzle/schema.ts agentKinds (guarded by kinds.test.ts).
export const AGENT_KINDS_DDL = `
CREATE TABLE IF NOT EXISTS agent_kinds (
  slug TEXT PRIMARY KEY REFERENCES agents(slug) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'agent',
  framework TEXT,
  topology TEXT,
  members TEXT NOT NULL DEFAULT '[]',
  source_format TEXT,
  extras TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_kinds_kind ON agent_kinds(kind);
`

export function ensureAgentKindsTable(sqlite: { exec(sql: string): unknown }): void {
  sqlite.exec(AGENT_KINDS_DDL)
}
