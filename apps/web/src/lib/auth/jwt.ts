/**
 * Minimal HS256 JWT — zero deps, no jose/jsonwebtoken.
 *
 *   Header   {"alg":"HS256","typ":"JWT"}
 *   Payload  application claims (set by caller)
 *   Sig      HMAC-SHA256(secret, base64url(header) + "." + base64url(payload))
 *
 * Spec-compatible: any standards-conforming JWT library can verify these
 * tokens given the shared secret.
 *
 * Crypto runs in Node's built-in `crypto`; we never need a polyfill, and
 * the runtime is identical between server actions, route handlers, and
 * (with the same secret) edge middleware via Web Crypto.
 */

import { createHmac, timingSafeEqual } from 'crypto'

const HEADER = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))

function getSecret(): string {
  const s =
    process.env.SESSION_JWT_SECRET ??
    process.env.COOKIE_SIGNING_SECRET ??
    process.env.PRIVY_APP_SECRET ??
    'dev-only-secret-rotate-in-prod'
  if (s === 'dev-only-secret-rotate-in-prod' && process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_JWT_SECRET must be configured in production')
  }
  return s
}

export interface JwtClaims {
  /** Subject — our internal user id (e.g. "did:privy:cat-001" or "0x<smartAccountAddr>"). */
  sub: string
  /** Issued at (unix seconds). */
  iat: number
  /** Expires at (unix seconds). */
  exp: number
  /** Token kind — "session" today, room for "recovery" / "invite" later. */
  kind?: 'session' | 'passkey-challenge'
  /** Optional user shape carried in the token to avoid an extra DB hit. */
  walletAddress?: string | null
  smartAccountAddress?: string | null
  name?: string
  email?: string | null
  /** Auth method used to obtain this token. */
  via?: 'demo' | 'passkey' | 'siwe' | 'google'
  /** For kind=passkey-challenge: the base64url-encoded random bytes the
   *  client must sign with their passkey. */
  challenge?: string
}

export interface SignOptions {
  /** Lifetime in seconds. Default 30 days. */
  ttlSeconds?: number
}

const DEFAULT_TTL = 60 * 60 * 24 * 30

export function signJwt(claims: Omit<JwtClaims, 'iat' | 'exp'> & { iat?: number; exp?: number }, opts: SignOptions = {}): string {
  const now = Math.floor(Date.now() / 1000)
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL
  const full: JwtClaims = {
    ...claims,
    iat: claims.iat ?? now,
    exp: claims.exp ?? now + ttl,
  }
  const payload = base64UrlEncode(JSON.stringify(full))
  const data = `${HEADER}.${payload}`
  const sig = base64UrlEncode(createHmac('sha256', getSecret()).update(data).digest())
  return `${data}.${sig}`
}

export function verifyJwt(token: string): JwtClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, sig] = parts
  if (header !== HEADER) return null
  const expected = base64UrlEncode(createHmac('sha256', getSecret()).update(`${header}.${payload}`).digest())
  if (!timingSafeStringEqual(sig, expected)) return null
  let claims: JwtClaims
  try {
    claims = JSON.parse(base64UrlDecode(payload).toString('utf8')) as JwtClaims
  } catch {
    return null
  }
  if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) return null
  return claims
}

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (s.length & 3)) & 3)
  return Buffer.from(padded, 'base64')
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}
