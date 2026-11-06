# Phase 36 Human UAT (in progress)

Real-service run against the LVI-INFO server is pending-human; exact commands are added by plans 36-04/36-05. Nothing in 36-01/36-02 needs a human step.

Quick manual check once available: start the app with LOCAL_MCP_AGENTS unset and POST to /api/local-mcp/v1/tools/search_products; expect 404 `{"message":"Not found"}` (401 from the hook if auth is on and the request is anonymous).
