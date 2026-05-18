/**
 * Minimal HS256 JWT — zero deps, no jose/jsonwebtoken.
 *
 *   Header   {"alg":"HS256","typ":"JWT","kid":"<active-kid>"}
 *   Payload  application claims (set by caller)
 *   Sig      HMAC-SHA256(secret, base64url(header) + "." + base64url(payload))
 *
 * Spec-compatible: any standards-conforming JWT library can verify these
 * tokens given the shared secret keyed by `kid`.
 *
 * Crypto runs in Node's built-in `crypto`; we never need a polyfill, and
 * the runtime is identical between server actions, route handlers, and
 * (with the same secret) edge middleware via Web Crypto.
 *
 * ── Key-id and rotation (Sprint 2 S2.4) ───────────────────────────────
 *
 * Signing keys are configured via `SESSION_JWT_SECRETS` — a
 * comma-separated list of `kid:secret_hex` pairs:
 *
 *   SESSION_JWT_SECRETS=2026-05-v2:<hex>,2026-05-v1:<hex>
 *
 *   - First entry is the ACTIVE signing key (used by `signJwt`).
 *   - ALL entries are valid for verification (used by `verifyJwt`).
 *   - During rotation, the previous kid stays in the list until every
 *     token it signed has expired (≤ cookie TTL).
 *
 * Backward compat: if only the legacy singular `SESSION_JWT_SECRET` is
 * set, it is registered with kid `'legacy'` for VERIFICATION ONLY —
 * `signJwt()` refuses to use it. Operators must explicitly opt into
 * multi-key by setting `SESSION_JWT_SECRETS`.
 *
 * Production guards (loadJwtKeys):
 *   - NODE_ENV=production AND no keys configured → throw
 *   - NODE_ENV=production AND the active signing kid is the well-known
 *     dev fallback (`dev-fallback`) → throw
 *
 * Rotation procedure: see
 *   docs/operations/kms-signer-setup.md § "Session JWT signing key (Sprint 2 S2.4)"
 */

import { createHmac, timingSafeEqual } from 'crypto'

// ─── Key registry ────────────────────────────────────────────────────

/**
 * The well-known dev fallback kid. Used only when no env is configured
 * (local-dev convenience). Production guards refuse to boot when the
 * active signing key carries this kid.
 */
const DEV_FALLBACK_KID = 'dev-fallback'
const DEV_FALLBACK_SECRET = 'dev-only-secret-rotate-in-prod'

/**
 * The legacy kid assigned to a token signed with the singular
 * `SESSION_JWT_SECRET` env var BEFORE multi-key was introduced. Such
 * tokens have NO `kid` header on the wire — the verifier infers this
 * synthetic kid from the absence of a header `kid`.
 */
const LEGACY_KID = 'legacy'

export interface SessionJwtKey {
  kid: string
  secret: Buffer
}

interface JwtKeyRegistry {
  /** Active signing key. `null` only in the legacy / verify-only case. */
  active: SessionJwtKey | null
  /** All keys valid for verification, indexed by kid. */
  byKid: Map<string, SessionJwtKey>
  /**
   * Fallback key for verifying header-less (no-`kid`) tokens, only
   * populated when the legacy singular `SESSION_JWT_SECRET` env var is
   * set. Used by the one-cycle backward-compat path.
   */
  legacyFallback: SessionJwtKey | null
}

/**
 * Parse SESSION_JWT_SECRETS / SESSION_JWT_SECRET into a key registry.
 *
 * Format: comma-separated `kid:secret_hex` pairs (whitespace tolerant).
 *
 * Order matters: the first entry is the ACTIVE signing key. Subsequent
 * entries remain valid for verification only — they exist so older
 * tokens signed before the most recent rotation continue to verify
 * until they expire.
 *
 * Exported for tests. Not memoized — env mutations under test should
 * take effect immediately. Cost is microseconds (small string parse +
 * Buffer alloc) so re-parsing on every JWT op is fine.
 */
export function loadJwtKeys(): JwtKeyRegistry {
  const multi = (process.env.SESSION_JWT_SECRETS ?? '').trim()
  const single = (process.env.SESSION_JWT_SECRET ?? '').trim()
  const cookieSigningSecret = (process.env.COOKIE_SIGNING_SECRET ?? '').trim()
  const isProd = process.env.NODE_ENV === 'production'

  if (multi) {
    const entries = multi
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((pair) => {
        const idx = pair.indexOf(':')
        if (idx <= 0 || idx === pair.length - 1) {
          throw new Error(
            `SESSION_JWT_SECRETS: malformed entry ${JSON.stringify(pair)} — expected "kid:secret_hex"`,
          )
        }
        const kid = pair.slice(0, idx).trim()
        const hex = pair.slice(idx + 1).trim()
        if (!kid) {
          throw new Error(`SESSION_JWT_SECRETS: empty kid in entry ${JSON.stringify(pair)}`)
        }
        return { kid, secret: bufferFromSecret(hex) }
      })

    if (entries.length === 0) {
      // Cannot happen given the filter above, but keep the guard for clarity.
      throw new Error('SESSION_JWT_SECRETS is set but parsed to zero keys')
    }

    // Reject duplicate kids — operator error that would silently lose a key.
    const seen = new Set<string>()
    for (const e of entries) {
      if (seen.has(e.kid)) {
        throw new Error(`SESSION_JWT_SECRETS: duplicate kid ${JSON.stringify(e.kid)}`)
      }
      seen.add(e.kid)
    }

    const active = entries[0]

    // Production guards.
    if (isProd && active.kid === DEV_FALLBACK_KID) {
      throw new Error(
        `Refusing to sign JWTs with the dev-fallback kid in production. ` +
          `Configure SESSION_JWT_SECRETS with operator-issued kids. ` +
          `See docs/operations/kms-signer-setup.md § "Session JWT signing key (Sprint 2 S2.4)".`,
      )
    }

    const byKid = new Map<string, SessionJwtKey>(entries.map((e) => [e.kid, e]))
    return { active, byKid, legacyFallback: null }
  }

  // Legacy single-secret path: kept verify-only so the next deploy
  // doesn't immediately invalidate every in-flight cookie. Operators
  // who want signing must switch to SESSION_JWT_SECRETS.
  const legacy = single || cookieSigningSecret
  if (legacy) {
    const key: SessionJwtKey = {
      kid: LEGACY_KID,
      secret: Buffer.from(legacy, 'utf8'),
    }
    return {
      active: null,
      byKid: new Map([[LEGACY_KID, key]]),
      legacyFallback: key,
    }
  }

  // No env at all. In production this is fatal. In dev we use the
  // hardcoded fallback so contributors don't need to configure anything
  // to boot the app.
  if (isProd) {
    throw new Error(
      `SESSION_JWT_SECRETS (or legacy SESSION_JWT_SECRET) must be configured in production. ` +
        `See docs/operations/kms-signer-setup.md § "Session JWT signing key (Sprint 2 S2.4)".`,
    )
  }

  const devKey: SessionJwtKey = {
    kid: DEV_FALLBACK_KID,
    secret: Buffer.from(DEV_FALLBACK_SECRET, 'utf8'),
  }
  return {
    active: devKey,
    byKid: new Map([[DEV_FALLBACK_KID, devKey]]),
    legacyFallback: null,
  }
}

function bufferFromSecret(secret: string): Buffer {
  // Accept either hex (preferred — matches the runbook's `openssl rand
  // -hex 32` recipe) or arbitrary opaque strings for dev convenience.
  // Heuristic: if the string is all hex chars and even-length ≥ 32
  // chars (≥ 16 bytes), decode as hex; otherwise treat as raw utf8.
  const looksHex = /^[0-9a-fA-F]+$/.test(secret) && secret.length >= 32 && secret.length % 2 === 0
  return looksHex ? Buffer.from(secret, 'hex') : Buffer.from(secret, 'utf8')
}

// ─── JWT claims ──────────────────────────────────────────────────────

export interface JwtClaims {
  /** Subject — our internal user id (e.g. "did:demo:cat-001" or "0x<smartAccountAddr>"). */
  sub: string
  /** Issued at (unix seconds). */
  iat: number
  /** Expires at (unix seconds). */
  exp: number
  /** Token kind — "session" today, room for "recovery" / "invite" later. */
  kind?: 'session' | 'passkey-challenge' | 'session-grant-pending'
  /** For kind=session-grant-pending: opaque sessionId minted at /start. */
  sessionId?: string
  /** For kind=session-grant-pending: SHA-256 of the canonical grant. */
  grantHash?: string
  /** For kind=session-grant-pending: random bytes mixed into the challenge. */
  serverNonce?: string
  /** For kind=session-grant-pending: full SessionGrantV1 body. */
  grant?: unknown
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

// ─── Sign / Verify ───────────────────────────────────────────────────

export function signJwt(
  claims: Omit<JwtClaims, 'iat' | 'exp'> & { iat?: number; exp?: number },
  opts: SignOptions = {},
): string {
  const { active } = loadJwtKeys()
  if (!active) {
    // Hit when the env is configured only with the legacy singular
    // SESSION_JWT_SECRET (verify-only). Operators must opt into signing
    // via SESSION_JWT_SECRETS.
    throw new Error(
      `signJwt: no active signing key configured. Set SESSION_JWT_SECRETS with a "kid:secret_hex" entry ` +
        `(the legacy SESSION_JWT_SECRET is honored for verification only). ` +
        `See docs/operations/kms-signer-setup.md § "Session JWT signing key (Sprint 2 S2.4)".`,
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL
  const full: JwtClaims = {
    ...claims,
    iat: claims.iat ?? now,
    exp: claims.exp ?? now + ttl,
  }

  const header = base64UrlEncode(
    JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: active.kid }),
  )
  const payload = base64UrlEncode(JSON.stringify(full))
  const data = `${header}.${payload}`
  const sig = base64UrlEncode(createHmac('sha256', active.secret).update(data).digest())
  return `${data}.${sig}`
}

export function verifyJwt(token: string): JwtClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payload, sig] = parts

  let header: { alg?: string; typ?: string; kid?: string }
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8')) as {
      alg?: string
      typ?: string
      kid?: string
    }
  } catch {
    return null
  }
  if (header.alg !== 'HS256') return null

  const { byKid, legacyFallback } = loadJwtKeys()

  // Pick the verification key. If the token carries a kid, use it
  // strictly — a kid we don't recognize means the key has been rotated
  // out of the list and the token is no longer valid.
  let key: SessionJwtKey | undefined
  if (typeof header.kid === 'string' && header.kid.length > 0) {
    key = byKid.get(header.kid)
  } else if (legacyFallback) {
    // Header-less (no kid) tokens — only honored if the operator has
    // the legacy SESSION_JWT_SECRET env set as a verify-only fallback.
    key = legacyFallback
  }
  if (!key) return null

  const expected = base64UrlEncode(
    createHmac('sha256', key.secret).update(`${headerB64}.${payload}`).digest(),
  )
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

// ─── Base64url helpers ───────────────────────────────────────────────

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

// ─── Test seam ───────────────────────────────────────────────────────

/**
 * Internal helpers exported for unit tests in `__tests__/native-session.test.ts`.
 * NOT part of the public API; callers in production code should rely on
 * `signJwt` / `verifyJwt` only.
 */
export const __testing = {
  DEV_FALLBACK_KID,
  DEV_FALLBACK_SECRET,
  LEGACY_KID,
}
