import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { AuthError, AuthService } from './auth'

const tempDirs: string[] = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function service(
  options: { allowedEmails?: string[]; allowedEmailDomains?: string[]; now?: () => number } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'aic-auth-'))
  tempDirs.push(directory)
  const dbPath = join(directory, 'auth.db')
  const sent: Array<{ email: string; code: string }> = []
  const auth = new AuthService({
    dbPath,
    allowedEmails: options.allowedEmails ?? ['member@example.org'],
    allowedEmailDomains: options.allowedEmailDomains,
    sendCode: async (email, code) => {
      sent.push({ email, code })
    },
    now: options.now,
  })
  return { auth, sent, dbPath }
}

describe('AuthService', () => {
  it('only sends a code to an exact whitelisted email address', async () => {
    const { auth, sent } = service()

    await expect(auth.requestLoginCode('outsider@example.org')).rejects.toMatchObject({
      code: 'not_allowed',
    })
    expect(sent).toHaveLength(0)

    const challenge = await auth.requestLoginCode(' Member@Example.org ')
    expect(challenge.email).toBe('member@example.org')
    expect(sent).toHaveLength(1)
    expect(sent[0].code).toMatch(/^\d{6}$/)
    auth.close()
  })

  it('sends a code to any address in a whitelisted email domain', async () => {
    const { auth, sent } = service({ allowedEmails: [], allowedEmailDomains: [' @Example.org '] })

    await auth.requestLoginCode('First.Person@EXAMPLE.ORG')
    await expect(auth.requestLoginCode('person@other.org')).rejects.toMatchObject({ code: 'not_allowed' })

    expect(sent.map(({ email }) => email)).toEqual(['first.person@example.org'])
    auth.close()
  })

  it('persists every address that successfully receives a code', async () => {
    let now = 1_000_000
    const { auth, dbPath } = service({ now: () => now })

    await auth.requestLoginCode('member@example.org')
    now += 1_000
    await auth.requestLoginCode('member@example.org')
    auth.close()

    const db = new Database(dbPath, { readonly: true })
    const recipients = db
      .prepare('SELECT email, first_sent_at, last_sent_at, send_count FROM login_code_recipients')
      .all()
    db.close()

    expect(recipients).toEqual([
      { email: 'member@example.org', first_sent_at: 1_000_000, last_sent_at: 1_001_000, send_count: 2 },
    ])
  })

  it('does not persist an address when email delivery fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aic-auth-'))
    tempDirs.push(directory)
    const dbPath = join(directory, 'auth.db')
    const auth = new AuthService({
      dbPath,
      allowedEmails: ['member@example.org'],
      sendCode: async () => {
        throw new Error('Delivery failed')
      },
    })

    await expect(auth.requestLoginCode('member@example.org')).rejects.toMatchObject({
      code: 'email_delivery',
    })
    auth.close()

    const db = new Database(dbPath, { readonly: true })
    const recipients = db.prepare('SELECT email FROM login_code_recipients').all()
    db.close()

    expect(recipients).toEqual([])
  })

  it('accepts a valid code once and creates a server-side session', async () => {
    const { auth, sent } = service()
    const challenge = await auth.requestLoginCode('member@example.org')
    const session = auth.verifyLoginCode(challenge.challengeId, challenge.email, sent[0].code)

    expect(session.token.length).toBeGreaterThan(30)
    expect(auth.getSession(session.token)).toMatchObject({ email: 'member@example.org' })
    expect(() => auth.verifyLoginCode(challenge.challengeId, challenge.email, sent[0].code)).toThrow(AuthError)

    auth.deleteSession(session.token)
    expect(auth.getSession(session.token)).toBeNull()
    auth.close()
  })

  it('keeps an actively used session alive with sliding expiration', async () => {
    let now = 1_000_000
    const { auth, sent } = service({ now: () => now })
    const challenge = await auth.requestLoginCode('member@example.org')
    const session = auth.verifyLoginCode(challenge.challengeId, challenge.email, sent[0].code)

    now += 6 * 24 * 60 * 60 * 1000
    const firstRefresh = auth.getSession(session.token)
    expect(firstRefresh?.expiresAt).toBe(now + 7 * 24 * 60 * 60 * 1000)
    expect(firstRefresh?.expiresAt).toBeGreaterThan(session.expiresAt)

    now += 6 * 24 * 60 * 60 * 1000
    expect(auth.getSession(session.token)).toMatchObject({ email: 'member@example.org' })

    now += 7 * 24 * 60 * 60 * 1000 + 1
    expect(auth.getSession(session.token)).toBeNull()
    auth.close()
  })

  it('expires login codes after ten minutes', async () => {
    let now = 1_000_000
    const { auth, sent } = service({ now: () => now })
    const challenge = await auth.requestLoginCode('member@example.org')
    now += 10 * 60 * 1000 + 1

    expect(() => auth.verifyLoginCode(challenge.challengeId, challenge.email, sent[0].code)).toThrow(
      expect.objectContaining({ code: 'expired_code' }),
    )
    auth.close()
  })

  it('limits code requests per email address', async () => {
    const { auth } = service()
    await auth.requestLoginCode('member@example.org')
    await auth.requestLoginCode('member@example.org')
    await auth.requestLoginCode('member@example.org')

    await expect(auth.requestLoginCode('member@example.org')).rejects.toMatchObject({
      code: 'rate_limited',
    })
    auth.close()
  })
})
