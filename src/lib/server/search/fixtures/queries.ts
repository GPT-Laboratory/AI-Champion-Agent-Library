// TEST ONLY - labeled query set for search accuracy tests. Plain data, no randomness.
//
// Scale queries are labeled by topic id (agent tags[1] in the synthetic corpus).
// keyword/nl queries reuse generated vocabulary (topic keywords, tool names);
// paraphrase queries deliberately share NO topic keyword or tool-name token.

export type QueryKind = 'keyword' | 'nl' | 'paraphrase'

export interface LabeledQuery {
  id: string
  corpus: 'scale' | 'real'
  kind: QueryKind
  query: string
  expectedTopics?: string[]
  expectedSlugs?: string[]
}

const scale = (
  id: string,
  kind: QueryKind,
  query: string,
  topic: string,
): LabeledQuery => ({ id, corpus: 'scale', kind, query, expectedTopics: [topic] })

const real = (
  id: string,
  kind: QueryKind,
  query: string,
  ...slugs: string[]
): LabeledQuery => ({ id, corpus: 'real', kind, query, expectedSlugs: slugs })

export const labeledQueries: LabeledQuery[] = [
  // --- scale: keyword ---
  scale('s-kw-hvac', 'keyword', 'ductwork', 'hvac'),
  scale('s-kw-electrical', 'keyword', 'switchboard', 'electrical'),
  scale('s-kw-electrical-2', 'keyword', 'cable-sizing', 'electrical'),
  scale('s-kw-plumbing', 'keyword', 'drainage', 'plumbing'),
  scale('s-kw-plumbing-2', 'keyword', 'pipe-sizing', 'plumbing'),
  scale('s-kw-fire', 'keyword', 'sprinkler', 'fire-safety'),
  scale('s-kw-fire-2', 'keyword', 'fire-rating', 'fire-safety'),
  scale('s-kw-rfi', 'keyword', 'question-log', 'rfi-triage'),
  scale('s-kw-sched', 'keyword', 'critical-path', 'scheduling'),
  scale('s-kw-sched-2', 'keyword', 'milestone', 'scheduling'),
  scale('s-kw-audit', 'keyword', 'non-conformance', 'compliance-audit'),
  scale('s-kw-cost', 'keyword', 'quantity-takeoff', 'cost-estimating'),
  scale('s-kw-bim', 'keyword', 'clash', 'bim-coordination'),
  scale('s-kw-doc', 'keyword', 'transmittal', 'document-control'),

  // --- scale: natural language with vocabulary overlap ---
  scale('s-nl-fire', 'nl', 'check sprinkler coverage for each compartment', 'fire-safety'),
  scale('s-nl-hvac', 'nl', 'size ductwork for a target airflow', 'hvac'),
  scale('s-nl-electrical', 'nl', 'calculate cable size from current and voltage drop', 'electrical'),
  scale('s-nl-plumbing', 'nl', 'size supply and drainage pipes from fixture units', 'plumbing'),
  scale('s-nl-rfi', 'nl', 'classify an rfi by discipline and route it to an owner', 'rfi-triage'),
  scale('s-nl-sched', 'nl', 'compare the schedule to the baseline and find the critical path', 'scheduling'),
  scale('s-nl-audit', 'nl', 'log a non-conformance and write an audit report', 'compliance-audit'),
  scale('s-nl-cost', 'nl', 'compare the estimate to the budget and explain variance', 'cost-estimating'),
  scale('s-nl-bim', 'nl', 'detect clashes between model elements and group them', 'bim-coordination'),
  scale('s-nl-doc', 'nl', 'check file naming convention and update the register', 'document-control'),

  // --- scale: paraphrase (no keyword overlap; asserted only with real embeddings) ---
  scale('s-pa-hvac', 'paraphrase', 'keep the building comfortable in summer', 'hvac'),
  scale('s-pa-rfi', 'paraphrase', 'who should reply to this site enquiry', 'rfi-triage'),
  scale('s-pa-sched', 'paraphrase', 'will the project finish when promised', 'scheduling'),
  scale('s-pa-cost', 'paraphrase', 'what will it set us back financially', 'cost-estimating'),
  scale('s-pa-fire', 'paraphrase', 'can people get out safely in an emergency', 'fire-safety'),
  scale('s-pa-electrical', 'paraphrase', 'is the wiring thick enough for the current', 'electrical'),
  scale('s-pa-plumbing', 'paraphrase', 'where do the toilets empty to', 'plumbing'),
  scale('s-pa-bim', 'paraphrase', 'do the 3D models of different trades bump into each other', 'bim-coordination'),
  scale('s-pa-doc', 'paraphrase', 'keep every drawing tidy and versioned', 'document-control'),
  scale('s-pa-audit', 'paraphrase', 'prove we meet the legal rules', 'compliance-audit'),

  // --- real catalog ---
  real('r-kw-etim', 'keyword', 'etim', 'etim-classification-repair'),
  real('r-kw-rfi', 'keyword', 'rfi', 'rfi-generation-from-findings'),
  real('r-kw-clash', 'keyword', 'clash', 'clash-prioritization'),
  real('r-kw-regulation', 'keyword', 'regulation', 'airo'),
  real('r-kw-quote', 'keyword', 'quote', 'quote-comparison'),
  real('r-kw-epd', 'keyword', 'epd', 'carbon-epd-enrichment'),
  real('r-nl-spool', 'nl', 'optimize spooling and pipe cutting', 'spooling-and-cutting'),
  real('r-nl-leadtime', 'nl', 'evaluate supplier procurement lead time', 'procurement-lead-time-check'),
  real('r-nl-delivery', 'nl', 'check material delivery receipts against orders', 'material-delivery-check'),
  real('r-pa-qto', 'paraphrase', 'normalize quantity measurements and units', 'qto-normalization'),
  real('r-pa-airo', 'paraphrase', 'which laws apply to our machine learning product', 'airo'),
  real('r-pa-bms', 'paraphrase', 'link telemetry sensor points to physical building components', 'bms-digital-twin'),
]
