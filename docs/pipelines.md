# Pipelines

A pipeline runs several agents one after the other on one page, with a deterministic tool between each pair and a
human approval at each hand-over. Each step is an ordinary Try It Out job (`src/lib/tryItOut.ts`, the job API is
unchanged), so each step gets its own tool step, tool check and download, exactly as on the agent's own page.

## Plain-language rules to E-BOM to M-BOM

Page: `/pipelines/rules-to-mbom`. Definition: `data/pipelines/rules-to-mbom/pipeline.yaml`. Each member agent's page
links to it ("Step n of the pipeline …").

| # | What happens | Who |
|---|---|---|
| Inputs | E-BOM data (the Scope Rule Drafter's example data, or your own file in the same format) and scope notes typed one per line (prefilled with the rule agent's example notes). If the data already has scope rules: keep them and add the new ones (default), replace them, or use only them (step 1 is skipped). | you |
| 1 | Scope Rule Drafter: notes to scope rules; the rule-check tool checks them and shows what each excludes. | model, tool |
| Gate 1 | The rules, editable. "Approve and continue" puts them into `## RULES` of the E-BOM data (`ebomUpload`, the same splice as the one-click hand-over). | you, tool |
| 2 | IFC EBOM Compiler on that data; its tool step applies the rules (`excluded_by`) and its check compares every class row with the ebom-join helper; `ebom.xlsx` is offered. | model, tool |
| Gate 2 | The ebom-join tool joins the class rows into E-BOM lines (block x designation, metres up to whole 3 m sticks) and maps each designation to product class, size and material (`designation-mapping.csv`). Rows that break the contract stop the pipeline here. | tool, you |
| 3 | Product Sourcing E-BOM to M-BOM on those lines and the catalog excerpt (`catalog-excerpt.csv`): matched, ambiguous or no-match per line, an M-BOM draft and open items. | model |

The tool steps are `src/lib/pipeline/rulesToMbom.ts` (pure, tested in `rulesToMbom.test.ts`, including the whole chain
run with tools only). The page is `src/routes/pipelines/[slug]` with `src/lib/components/PipelineRunner.svelte`; the
loader is `src/lib/server/pipelines.ts`.

The example is built so the last step shows each sourcing outcome: the bend matches but is sold in packs of 5 (unit
review), the 250 duct matches cleanly, the 100 duct has two suppliers (ambiguous).

All data is synthetic. Every result is a draft for expert review.

## Notes

- The steps run in the visitor's session one after the other; on the container path each step warms its own
  container (the session's container is replaced when the agent changes), so a step can take a little longer to start.
- There is no `kind: system` catalog entry: with `AGENT_KINDS` on, `data/agents` may only add the library's own
  MCP-server entries (`scripts/ingest.kinds.test.ts`), and the flag is off by default. The agent-page links lead here.
- Running the pipeline needs all three agents to be runnable; otherwise the page says so and the run button is off.
