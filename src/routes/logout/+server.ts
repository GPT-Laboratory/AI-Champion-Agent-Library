import { redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { AUTH_COOKIE_NAME, authCookieOptions, getAuthService } from '$lib/server/auth'

export const POST: RequestHandler = async ({ cookies, url }) => {
  const token = cookies.get(AUTH_COOKIE_NAME)
  if (token) getAuthService().deleteSession(token)
  cookies.delete(AUTH_COOKIE_NAME, authCookieOptions(url))
  redirect(303, '/login')
}
