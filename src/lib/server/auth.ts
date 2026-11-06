import Database from 'better-sqlite3'
import { createHash, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { env } from '$env/dynamic/private'

export const AUTH_COOKIE_NAME = 'aic_session'

const CODE_LIFETIME_MS = 10 * 60 * 1000
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const MAX_CODE_REQUESTS = 3
const MAX_VERIFY_ATTEMPTS = 5

export type AuthErrorCode =
  | 'invalid_email'
  | 'not_allowed'
  | 'rate_limited'
  | 'invalid_code'
  | 'expired_code'
  | 'configuration'
  | 'email_delivery'

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export type LoginChallenge = {
  challengeId: string
  email: string
  expiresAt: number
}

type AuthServiceOptions = {
  dbPath: string
  allowedEmails: string[]
  allowedEmailDomains?: string[]
  sendCode: (email: string, code: string) => Promise<void>
  now?: () => number
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function isEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function normalizeEmailDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@/, '')
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function codeHash(code: string, salt: Buffer): Buffer {
  return scryptSync(code, salt, 32)
}

export class AuthService {
  private readonly db: Database.Database
  private readonly allowedEmails: Set<string>
  private readonly allowedEmailDomains: Set<string>
  private readonly sendCode: AuthServiceOptions['sendCode']
  private readonly now: () => number

  constructor(options: AuthServiceOptions) {
    mkdirSync(dirname(options.dbPath), { recursive: true })
    this.db = new Database(options.dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.allowedEmails = new Set(options.allowedEmails.map(normalizeEmail).filter(Boolean))
    this.allowedEmailDomains = new Set(
      (options.allowedEmailDomains ?? []).map(normalizeEmailDomain).filter(Boolean),
    )
    this.sendCode = options.sendCode
    this.now = options.now ?? Date.now
    this.createSchema()
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS login_codes (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        code_hash BLOB NOT NULL,
        code_salt BLOB NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumed_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS login_codes_email_idx ON login_codes(email, created_at);

      CREATE TABLE IF NOT EXISTS auth_request_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        requested_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS auth_request_log_email_idx ON auth_request_log(email, requested_at);

      CREATE TABLE IF NOT EXISTS login_code_recipients (
        email TEXT PRIMARY KEY,
        first_sent_at INTEGER NOT NULL,
        last_sent_at INTEGER NOT NULL,
        send_count INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS login_sessions (
        token_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS login_sessions_expiry_idx ON login_sessions(expires_at);
    `)
  }

  async requestLoginCode(rawEmail: string): Promise<LoginChallenge> {
    const email = normalizeEmail(rawEmail)
    if (!isEmail(email)) throw new AuthError('invalid_email', 'Enter a valid email address.')
    if (this.allowedEmails.size === 0 && this.allowedEmailDomains.size === 0) {
      throw new AuthError('configuration', 'The email whitelist has not been configured.')
    }
    const emailDomain = email.slice(email.lastIndexOf('@') + 1)
    if (!this.allowedEmails.has(email) && !this.allowedEmailDomains.has(emailDomain)) {
      throw new AuthError('not_allowed', 'This email address is not authorized for the consortium library.')
    }

    const now = this.now()
    this.cleanup(now)
    const recentRequests = this.db
      .prepare('SELECT COUNT(*) AS count FROM auth_request_log WHERE email = ? AND requested_at >= ?')
      .get(email, now - RATE_LIMIT_WINDOW_MS) as { count: number }
    if (recentRequests.count >= MAX_CODE_REQUESTS) {
      throw new AuthError('rate_limited', 'Too many code requests. Try again in 15 minutes.')
    }
    this.db.prepare('INSERT INTO auth_request_log (email, requested_at) VALUES (?, ?)').run(email, now)

    const id = randomUUID()
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
    const salt = randomBytes(16)
    const expiresAt = now + CODE_LIFETIME_MS

    try {
      await this.sendCode(email, code)
    } catch (error) {
      console.error('Login email delivery failed', error)
      throw new AuthError('email_delivery', 'The login email could not be sent. Please try again later.')
    }

    const saveChallenge = this.db.transaction(() => {
      this.db
        .prepare('UPDATE login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL')
        .run(now, email)
      this.db
        .prepare(`
          INSERT INTO login_codes (id, email, code_hash, code_salt, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(id, email, codeHash(code, salt), salt, expiresAt, now)
      this.db
        .prepare(`
          INSERT INTO login_code_recipients (email, first_sent_at, last_sent_at, send_count)
          VALUES (?, ?, ?, 1)
          ON CONFLICT(email) DO UPDATE SET
            last_sent_at = excluded.last_sent_at,
            send_count = login_code_recipients.send_count + 1
        `)
        .run(email, now, now)
    })
    saveChallenge()

    return { challengeId: id, email, expiresAt }
  }

  verifyLoginCode(challengeId: string, rawEmail: string, code: string): { token: string; expiresAt: number } {
    const email = normalizeEmail(rawEmail)
    const now = this.now()
    const row = this.db
      .prepare(`
        SELECT id, email, code_hash, code_salt, expires_at, attempts, consumed_at
        FROM login_codes WHERE id = ? AND email = ?
      `)
      .get(challengeId, email) as
      | {
          id: string
          email: string
          code_hash: Buffer
          code_salt: Buffer
          expires_at: number
          attempts: number
          consumed_at: number | null
        }
      | undefined

    if (!row || row.consumed_at !== null || row.attempts >= MAX_VERIFY_ATTEMPTS) {
      throw new AuthError('invalid_code', 'The code is invalid or has already been used.')
    }
    if (row.expires_at < now) {
      this.db.prepare('UPDATE login_codes SET consumed_at = ? WHERE id = ?').run(now, row.id)
      throw new AuthError('expired_code', 'The code has expired. Request a new one.')
    }

    const suppliedHash = codeHash(code, row.code_salt)
    if (suppliedHash.length !== row.code_hash.length || !timingSafeEqual(suppliedHash, row.code_hash)) {
      this.db
        .prepare(`
          UPDATE login_codes
          SET attempts = attempts + 1,
              consumed_at = CASE WHEN attempts + 1 >= ? THEN ? ELSE consumed_at END
          WHERE id = ?
        `)
        .run(MAX_VERIFY_ATTEMPTS, now, row.id)
      throw new AuthError('invalid_code', 'The code is invalid or has already been used.')
    }

    const token = randomBytes(32).toString('base64url')
    const expiresAt = now + SESSION_LIFETIME_MS
    const finishLogin = this.db.transaction(() => {
      this.db.prepare('UPDATE login_codes SET consumed_at = ? WHERE id = ?').run(now, row.id)
      this.db
        .prepare('INSERT INTO login_sessions (token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .run(tokenHash(token), email, expiresAt, now)
    })
    finishLogin()
    return { token, expiresAt }
  }

  getSession(token: string): { email: string; expiresAt: number } | null {
    if (!token) return null
    const hash = tokenHash(token)
    const now = this.now()
    const row = this.db
      .prepare('SELECT email, expires_at FROM login_sessions WHERE token_hash = ?')
      .get(hash) as { email: string; expires_at: number } | undefined
    if (!row) return null
    if (row.expires_at < now) {
      this.db.prepare('DELETE FROM login_sessions WHERE token_hash = ?').run(hash)
      return null
    }

    const expiresAt = now + SESSION_LIFETIME_MS
    this.db.prepare('UPDATE login_sessions SET expires_at = ? WHERE token_hash = ?').run(expiresAt, hash)
    return { email: row.email, expiresAt }
  }

  deleteSession(token: string): void {
    if (token) this.db.prepare('DELETE FROM login_sessions WHERE token_hash = ?').run(tokenHash(token))
  }

  close(): void {
    this.db.close()
  }

  private cleanup(now: number): void {
    this.db.prepare('DELETE FROM auth_request_log WHERE requested_at < ?').run(now - RATE_LIMIT_WINDOW_MS)
    this.db.prepare('DELETE FROM login_sessions WHERE expires_at < ?').run(now)
    this.db.prepare('DELETE FROM login_codes WHERE expires_at < ?').run(now - 24 * 60 * 60 * 1000)
  }
}

let service: AuthService | undefined

export function getAuthService(): AuthService {
  if (!service) {
    const allowedEmails = (env.AUTH_ALLOWED_EMAILS ?? '').split(',')
    const allowedEmailDomains = (env.AUTH_ALLOWED_EMAIL_DOMAINS ?? '').split(',')
    service = new AuthService({
      dbPath: env.AUTH_DB_PATH ?? 'runtime/auth/auth.db',
      allowedEmails,
      allowedEmailDomains,
      sendCode: async (email, code) => {
        const { sendLoginCode } = await import('./mail')
        await sendLoginCode(email, code)
      },
    })
  }
  return service
}

export function authCookieOptions(url: URL, expiresAt?: number) {
  const configuredSecure = env.AUTH_COOKIE_SECURE
  const secure = configuredSecure === 'true' || (configuredSecure !== 'false' && url.protocol === 'https:')
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  }
}
