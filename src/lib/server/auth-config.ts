import { env } from '$env/dynamic/private'

export function parseAuthenticationEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== 'false'
}

export function isAuthenticationEnabled(): boolean {
  return parseAuthenticationEnabled(env.AUTH_ENABLED)
}
