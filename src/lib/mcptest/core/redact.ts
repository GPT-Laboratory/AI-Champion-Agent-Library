// Redaction for report text. Pure and total. Core purity: no $lib, svelte or @sveltejs imports.

import { redactText } from '../../spec/security'

export const REDACT_CAP = 200
const MASK = '[redacted]'

/**
 * Masks the given secrets (for example the per-run canary), Bearer tokens and long key-like tokens,
 * then caps the length. Never returns more than `cap` characters.
 */
export function redact(text: string, extraSecrets: string[] = [], cap: number = REDACT_CAP): string {
  let out = typeof text === 'string' ? text : String(text)
  for (const s of extraSecrets) {
    if (typeof s === 'string' && s.length >= 4) out = out.split(s).join(MASK)
  }
  out = out.replace(/\bBearer\s+[^\s"',;]+/gi, `Bearer ${MASK}`)
  out = redactText(out) // shared token shapes (G2): ghp_/xox/AKIA/PEM, additive to the long-run mask
  out = out.replace(/[A-Za-z0-9_-]{32,}/g, MASK)
  const limit = Math.max(4, cap)
  if (out.length > limit) out = out.slice(0, limit - 3) + '...'
  return out
}

/**
 * For short identifiers a server reports about itself (tool names, server name and version, protocol version).
 * Masks the given secrets and Bearer tokens, drops control characters and caps the length, but leaves long
 * key-like names alone (a 40 character snake_case tool name is legitimate and must stay readable).
 */
export function redactName(text: string, extraSecrets: string[] = [], cap = 80): string {
  let out = typeof text === 'string' ? text : String(text)
  for (const s of extraSecrets) {
    if (typeof s === 'string' && s.length >= 4) out = out.split(s).join(MASK)
  }
  out = out.replace(/\bBearer\s+[^\s"',;]+/gi, `Bearer ${MASK}`)
  out = redactText(out)
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\u0000-\u001f\u007f]+/g, ' ')
  const limit = Math.max(4, cap)
  if (out.length > limit) out = out.slice(0, limit - 3) + '...'
  return out
}

/** Builds a redactor closure over fixed secrets. */
export function makeRedactor(secrets: string[], cap: number = REDACT_CAP): (s: string) => string {
  return (s: string) => redact(s, secrets, cap)
}
