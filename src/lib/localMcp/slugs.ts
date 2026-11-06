// The local-MCP surface (Phase 36, D-637). Everything below is removed from the release branch by Phase 38:
//   this file, data/agents-local/, data/tryitout-prompts-local/, src/lib/server/localMcp/,
//   src/routes/api/local-mcp/, docs/local-mcp-agent.md.
// The only slug list outside data/agents-local.
export const LOCAL_MCP_SERVER_SLUGS = ['stk-mcp', 'stk-catalog-mcp', 'lvi-info-mcp'] as const
export const LVI_AGENT_SLUG = 'lvi-info-product-match'
export const LOCAL_MCP_SLUGS: readonly string[] = [...LOCAL_MCP_SERVER_SLUGS, LVI_AGENT_SLUG]
