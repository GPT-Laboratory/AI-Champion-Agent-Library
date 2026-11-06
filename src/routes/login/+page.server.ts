import { fail, redirect } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { AUTH_COOKIE_NAME, AuthError, authCookieOptions, getAuthService } from '$lib/server/auth'

function safeNext(value: FormDataEntryValue | string | null): string {
  const next = typeof value === 'string' ? value : ''
  return next.startsWith('/') && !next.startsWith('//') ? next : '/catalog'
}

function errorStatus(error: AuthError): number {
  if (error.code === 'rate_limited') return 429
  if (error.code === 'email_delivery' || error.code === 'configuration') return 503
  return 400
}

export const load: PageServerLoad = async ({ url }) => ({ next: safeNext(url.searchParams.get('next')) })

export const actions: Actions = {
  requestCode: async ({ request }) => {
    const data = await request.formData()
    const email = String(data.get('email') ?? '')
    const next = safeNext(data.get('next'))
    try {
      const challenge = await getAuthService().requestLoginCode(email)
      return {
        step: 'verify' as const,
        email: challenge.email,
        challengeId: challenge.challengeId,
        next,
        message: 'We sent a six-digit login code to your email address.',
      }
    } catch (error) {
      if (error instanceof AuthError) {
        return fail(errorStatus(error), { step: 'request' as const, email, next, error: error.message })
      }
      console.error('Unexpected login code request failure', error)
      return fail(500, { step: 'request' as const, email, next, error: 'Login is temporarily unavailable.' })
    }
  },
  verify: async ({ request, cookies, url }) => {
    const data = await request.formData()
    const email = String(data.get('email') ?? '')
    const challengeId = String(data.get('challengeId') ?? '')
    const code = String(data.get('code') ?? '').replace(/\s/g, '')
    const next = safeNext(data.get('next'))

    if (!/^\d{6}$/.test(code)) {
      return fail(400, {
        step: 'verify' as const,
        email,
        challengeId,
        next,
        error: 'Enter the six-digit code from the email.',
      })
    }

    try {
      const session = getAuthService().verifyLoginCode(challengeId, email, code)
      cookies.set(AUTH_COOKIE_NAME, session.token, authCookieOptions(url, session.expiresAt))
    } catch (error) {
      if (error instanceof AuthError) {
        return fail(errorStatus(error), {
          step: 'verify' as const,
          email,
          challengeId,
          next,
          error: error.message,
        })
      }
      console.error('Unexpected login verification failure', error)
      return fail(500, {
        step: 'verify' as const,
        email,
        challengeId,
        next,
        error: 'Login is temporarily unavailable.',
      })
    }
    redirect(303, next)
  },
}
