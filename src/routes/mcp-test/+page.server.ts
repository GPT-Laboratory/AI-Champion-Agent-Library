// /mcp-test (Phase 15, flag MCP_TESTER, default off): 404 when the flag is off, before anything is read.
// Only SvelteKit-recognised exports may live here (the page helpers are in $lib/mcptest/pageData).
import { error } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { mcpTesterEnabled } from '$lib/flags.js'
import { listCases, listPageSubjects } from '$lib/mcptest/pageData.js'

export const load: PageServerLoad = () => {
  if (!mcpTesterEnabled()) error(404, 'Not found')
  return { subjects: listPageSubjects(), cases: listCases() }
}

// WR-02: a POST to the page answers 404 with the flag off (SvelteKit would say 405 "no actions exist"), 405 with it on.
export const actions: Actions = {
  default: () => {
    if (!mcpTesterEnabled()) error(404, 'Not found')
    error(405, 'Method not allowed')
  }
}
