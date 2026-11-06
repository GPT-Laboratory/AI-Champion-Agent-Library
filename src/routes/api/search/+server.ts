import { json } from '@sveltejs/kit'
import { search } from '$lib/server/search/index.js'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200)
  if (!q) return json({ results: [], mode: 'none' })
  try {
    const { results, mode } = await search(q)
    return json({ results: results.map((r) => ({ slug: r.slug, score: r.score })), mode })
  } catch (err) {
    console.error('Search failed', err)
    return json({ message: 'Search failed.' }, { status: 500 })
  }
}
