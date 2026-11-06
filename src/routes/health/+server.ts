import { json } from '@sveltejs/kit'
import { db, agents } from '$lib/server/db.js'

// D-460: readiness, not just liveness. One single-row read of the agents table proves the database
// file opens and the schema exists. Failure is a bare 503 { message }: the cause is never exposed.
export const GET = () => {
  try {
    db.select({ slug: agents.slug }).from(agents).limit(1).all()
    return json({ status: 'ok' })
  } catch {
    return json({ message: 'Service unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
