import { createHmac } from 'crypto'

const COOKIE_SECRET = process.env.COOKIE_SIGNING_SECRET ?? process.env.PRIVY_APP_SECRET ?? 'dev-cookie-secret'

/** Sign a cookie value: returns "value.signature" */
export function signCookie(value: string): string {
  const sig = createHmac('sha256', COOKIE_SECRET).update(value).digest('hex').slice(0, 16)
  return `${value}.${sig}`
}

/** Verify and extract the value from a signed cookie. Returns null if invalid. */
export function verifyCookie(signed: string): string | null {
  const dotIdx = signed.lastIndexOf('.')
  if (dotIdx < 0) return null
  const value = signed.slice(0, dotIdx)
  const expected = signCookie(value)
  return expected === signed ? value : null
}
