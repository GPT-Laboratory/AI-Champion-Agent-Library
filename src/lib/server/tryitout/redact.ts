// src/lib/server/tryitout/redact.ts
// Server-only. Keeps upstream error bodies, engine error details and key-like
// strings out of anything a visitor can read (job.error, the progress feed).
// Detail is logged server-side only, after redaction (WR-06, D-17).

import { isTryItOutRuntimeError } from './runtime'
import { redactText } from '../../spec/security'

const SECRET_PATTERNS: RegExp[] = [
  /(?<![A-Za-z0-9_])sk-[A-Za-z0-9_*.-]{3,}/g, // OpenAI-style keys, including masked ones (sk-proj-****abcd); not inside words like task-force
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
]

/** Replaces key-like strings with a placeholder. Total: never throws. */
export function redactSecrets(s: string): string {
  let out = s
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]')
  // Shared list (G2): ghp_/xox/AKIA/PEM shapes are masked here too; the extras above stay.
  return redactText(out)
}

const MAX_PUBLIC_CHARS = 200

/** Redacted and bounded, for plain (non-runtime) error text shown to the visitor. */
export function publicText(s: string): string {
  const red = redactSecrets(s)
  return red.length > MAX_PUBLIC_CHARS ? `${red.slice(0, MAX_PUBLIC_CHARS - 1)}…` : red
}

/**
 * User-facing message for a failure. TryItOutRuntimeError details (socket path, image name, build
 * hint, network refusal text) never reach the visitor; the few messages that are fixed and safe
 * (busy, session_busy, output limits) are kept.
 */
export function publicErrorMessage(err: unknown): string {
  if (isTryItOutRuntimeError(err)) {
    switch (err.code) {
      case 'engine_unavailable':
        return 'container engine unavailable'
      case 'busy':
      case 'session_busy':
        return err.message
      case 'output_invalid':
        return /^output exceeds \d+ (files|bytes)$/.test(err.message)
          ? err.message
          : 'container output was invalid'
      default:
        return 'container engine error'
    }
  }
  return publicText(err instanceof Error ? err.message : String(err))
}

/** Server-side log of the full (redacted) detail behind a generic public message. */
export function logDetail(context: string, detail: unknown): void {
  const text = detail instanceof Error ? detail.message : String(detail)
  console.error(context, redactSecrets(text))
}
