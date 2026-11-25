// Which agents' skills come with a deterministic helper, and what to run before and after the skill (docs/skill-download.md).
// Shared by the build step that bundles each helper into one dependency-free file (scripts/build-skill-helpers.ts)
// and the skill download (src/lib/server/skillBundle.ts), which puts that file and these instructions in the zip.
// `helper` is the CLI in scripts/<helper>.ts; in the download it is scripts/<helper>.mjs, run with plain `node`.

export interface HelperStep {
  /** The command, run in the unzipped folder (`<input>` etc. are placeholders for the user's files). */
  command: string
  /** What it does, one or two sentences. */
  what: string
  /** Before the skill only: false when the skill can do without it (less reliably). Default true. */
  required?: boolean
}

export interface SkillHelper {
  helper: string
  /** Required before the skill: the skill does not work on the raw input. */
  before?: HelperStep
  /** After the skill: computes what the skill leaves to a tool and/or checks the result cell by cell. */
  after: HelperStep
}

const check = (helper: string, input: string, extra = '') =>
  `node scripts/${helper}.mjs ${input} result.md${extra}`

export const SKILL_HELPERS: Readonly<Record<string, SkillHelper>> = {
  'warranty-register-check': {
    helper: 'warranty-status',
    before: {
      command: 'node scripts/warranty-status.mjs register.csv > upload.txt',
      what: 'Fills in the precomputed columns (expected end date, dates consistent, days remaining, status class, presence checks). The skill reads upload.txt; it never calculates a date.',
    },
    after: { command: check('warranty-status', 'register.csv'), what: 'Checks the result table cell by cell (exit 0: every cell matches).' },
  },
  'procurement-lead-time-check': {
    helper: 'procurement-lead-time',
    before: {
      command: 'node scripts/procurement-lead-time.mjs items.csv > upload.txt',
      what: 'Fills in the precomputed order dates and flags. The skill reads upload.txt; it never calculates a date.',
    },
    after: { command: check('procurement-lead-time', 'items.csv'), what: 'Checks the result table cell by cell (exit 0: every cell matches).' },
  },
  'material-delivery-check': {
    helper: 'delivery-check',
    before: {
      command: 'node scripts/delivery-check.mjs lines.csv > upload.txt',
      what: 'Fills in the precomputed balance, lateness and conflict columns. The skill reads upload.txt; it never calculates.',
    },
    after: { command: check('delivery-check', 'lines.csv'), what: 'Checks the result table cell by cell (exit 0: every cell matches).' },
  },
  'ifc-ebom-compiler': {
    helper: 'ebom-join',
    before: {
      command: 'node scripts/ebom-join.mjs upload.txt --prepare > prepared.txt',
      required: false,
      what: 'Applies the scope rules: adds the excluded_by column to ELEMENTS and the RULES NOT TIED TO DATA section. Give the skill prepared.txt (without it the skill applies the rules itself, less reliably).',
    },
    after: {
      command: check('ebom-join', 'upload.txt'),
      what: 'Checks every class row against the contract and the helper, and joins the billed rows into E-BOM lines (metres and pieces per block and designation, rounded up to whole 3 m sticks; --stick-m changes it).',
    },
  },
  'scope-rule-drafter': {
    helper: 'rule-check',
    before: {
      command: 'node scripts/rule-check.mjs ebom-data.txt --prepare > upload.txt',
      required: false,
      what: 'Adds the ## VALUES list (the only values a rule may name). Give the skill upload.txt and type the notes as the task (without it the skill writes the list itself).',
    },
    after: {
      command: check('rule-check', 'ebom-data.txt', ' --task notes.txt'),
      what: 'Checks every rule (shape, field and value in the data, exclusion wording, value named in its note) and shows which elements each rule would exclude.',
    },
  },
  'bms-digital-twin': {
    helper: 'bms-point-status',
    after: { command: check('bms-point-status', 'input.txt'), what: 'Works out the threshold statuses the skill leaves as "to compute (tool)" and checks the point mapping cell by cell; without result.md it prints the binding and statuses.' },
  },
  'carbon-epd-enrichment': {
    helper: 'carbon-lifecycle',
    after: { command: check('carbon-lifecycle', 'input.txt'), what: 'Computes the stage totals and the option comparison the skill leaves to a tool and checks the per-product rows; without result.md it prints the mapping and totals.' },
  },
  'qto-normalization': {
    helper: 'qto-group-totals',
    after: { command: check('qto-group-totals', 'input.csv'), what: 'Computes the totals by group and level the skill leaves to a tool and checks the normalised rows; without result.md it prints the totals.' },
  },
  'clash-prioritization': {
    helper: 'clash-patterns',
    after: { command: 'node scripts/clash-patterns.mjs clash-report.csv result.md', what: 'Groups the open clashes into patterns and writes the findings table the RFI agent reads.' },
  },
  'quote-comparison': {
    helper: 'bid-weighted-score',
    after: { command: 'node scripts/bid-weighted-score.mjs input.txt', what: 'Computes the weighted bid totals and the ranking the skill never calculates.' },
  },
  'product-sourcing-mbom': {
    helper: 'sourcing-match',
    after: { command: check('sourcing-match', 'upload.txt'), what: 'Checks the per-line rows, the M-BOM draft and the open items cell by cell against the skill\'s matching rules; without result.md it prints the reference result.' },
  },
}

/** Every helper CLI to bundle, once each. */
export const helperNames = (): string[] => [...new Set(Object.values(SKILL_HELPERS).map((h) => h.helper))].sort()
