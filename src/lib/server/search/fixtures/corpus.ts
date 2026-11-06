// TEST ONLY - corpus loaders for search accuracy tests. Read-only: never writes data/.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { generateAgents } from '../../../../../scripts/fixtures/generate-scale.js'
import { detectFormat, normalize } from '../../../spec/index.js'
import { buildSearchText, recordToSearchable, type Searchable } from '../documents.js'
import type { Bm25Doc } from '../bm25.js'

export interface Corpus {
  docs: Bm25Doc[]
  searchables: Searchable[]
  topicOf: (slug: string) => string | undefined
}

function toCorpus(searchables: Searchable[], topics: Map<string, string>): Corpus {
  return {
    searchables,
    docs: searchables.map((s) => ({
      slug: s.slug,
      title: s.title,
      tags: s.tags,
      text: buildSearchText(s),
    })),
    topicOf: (slug) => topics.get(slug),
  }
}

function load(yaml: string) {
  const raw = parseYaml(yaml)
  return normalize(detectFormat(raw), raw)
}

/** 150 deterministic synthetic agents (15 per topic). No filesystem or DB access. */
export function loadScaleCorpus(): Corpus {
  const searchables: Searchable[] = []
  const topics = new Map<string, string>()
  for (const g of generateAgents(150)) {
    const record = load(g.yaml)
    searchables.push(recordToSearchable(record))
    // tags = ['synthetic', <topic id>, ...keywords]
    topics.set(record.slug, record.tags[1])
  }
  return toCorpus(searchables, topics)
}

/** The real catalog YAMLs in data/agents (read-only; skips subdirectories). */
export function loadRealCorpus(dir = './data/agents'): Corpus {
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
    .map((e) => e.name)
    .sort()
  const searchables = files.map((f) => recordToSearchable(load(readFileSync(join(dir, f), 'utf-8'))))
  return toCorpus(searchables, new Map())
}
