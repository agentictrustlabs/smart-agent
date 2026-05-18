/**
 * Google OAuth (server-side code flow) for the native auth stack.
 *
 * Flow:
 *   1. Server redirects browser to Google's /authorize with state+nonce cookies.
 *   2. Google redirects back to /api/auth/google-callback with `code`.
 *   3. Server POSTs to /token with client_secret to exchange code → id_token.
 *   4. Server decodes id_token (TLS + client_secret already established issuer
 *      authenticity; the JWT here is informational, not the auth credential).
 *   5. Server verifies aud/iss/nonce/exp.
 *   6. Caller takes the verified email and derives a smart-account address.
 */

import { randomBytes } from 'node:crypto'
import { deriveOauthSaltBigInt } from './oauth-salt'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const VALID_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

/** Cookie names used by /api/auth/google-start and /api/auth/google-callback. */
export const STATE_COOKIE = 'sa-oauth-state'
export const NONCE_COOKIE = 'sa-oauth-nonce'
/** Caller's flow intent ('recover' routes the callback to /recover-device). */
export const INTENT_COOKIE = 'sa-oauth-intent'
/**
 * Optional return-to URL set by /api/auth/google-start when the caller
 * passed `?return_to=`. The callback honors this after session mint so
 * users come back to the page they started from (e.g. /h/{slug}).
 */
export const RETURN_TO_COOKIE = 'sa-oauth-return-to'

export type OAuthIntent = 'login' | 'recover'

export interface GoogleEnv {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function getGoogleEnv(): GoogleEnv {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth env not configured: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI')
  }
  return { clientId, clientSecret, redirectUri }
}

/** Per-request opaque random bytes (URL-safe base64). */
export function randomToken(bytes = 32): string {
  return base64UrlEncode(randomBytes(bytes))
}

/** Build the Google /authorize URL for the redirect. */
export function buildAuthorizeUrl(env: GoogleEnv, state: string, nonce: string): string {
  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state,
    nonce,
  })
  return `${AUTH_URL}?${params.toString()}`
}

interface TokenResponse {
  id_token: string
  access_token: string
  token_type: string
  expires_in: number
  scope: string
}

/** Exchange the authorization code for tokens. */
export async function exchangeCode(env: GoogleEnv, code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    redirect_uri: env.redirectUri,
    grant_type: 'authorization_code',
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google /token failed: ${res.status} ${text}`)
  }
  return (await res.json()) as TokenResponse
}

export interface GoogleIdClaims {
  iss: string
  aud: string
  sub: string
  email: string
  email_verified?: boolean
  name?: string
  picture?: string
  exp: number
  nonce?: string
}

/**
 * Decode and verify the Google ID token. We rely on:
 *   - TLS + client_secret authentication of the /token endpoint (token came
 *     from Google directly to us, no MITM possible) for *issuer authenticity*.
 *   - The JWT body for the user identity claims.
 *   - aud + iss + nonce + exp checks below for replay/swap protection.
 *
 * We do NOT validate the JWT signature here — the TLS handshake already
 * authenticated Google. (For implicit flows or browser-side ID tokens, JWKS
 * verification would be required.)
 */
export function decodeAndVerifyIdToken(idToken: string, env: GoogleEnv, expectedNonce: string): GoogleIdClaims {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('malformed id_token')
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as GoogleIdClaims

  if (!VALID_ISSUERS.has(payload.iss)) throw new Error(`unexpected iss=${payload.iss}`)
  if (payload.aud !== env.clientId) throw new Error(`unexpected aud=${payload.aud}`)
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) throw new Error('id_token expired')
  if (!payload.nonce || payload.nonce !== expectedNonce) throw new Error('nonce mismatch')
  if (!payload.email) throw new Error('id_token missing email')
  if (payload.email_verified === false) throw new Error('email not verified by Google')
  return payload
}

/**
 * Derive the deterministic smart-account salt for a Google identity.
 *
 *   salt = HMAC_SHA_256(oauthSaltKey, "oauth-salt:v1:" + lower(email) + ":" + rotation)
 *
 * Same email + rotation → same salt → same counterfactual smart-account
 * address forever (assuming the same factory + serverSigner +
 * delegationManager triplet AND the same `oauth-salt` KMS HMAC key).
 * `rotation` is a per-user counter that the "Start fresh" escape hatch
 * bumps so users can abandon a stuck account and re-deploy at a new
 * address.
 *
 * Sprint S2.6: this used to be `sha256(SERVER_PEPPER ‖ email ‖ rotation)`
 * using a long-lived symmetric env secret. The pepper is replaced by a
 * KMS HMAC key id (`oauth-salt`) — locally a hex key in
 * `OAUTH_SALT_HMAC_KEY`, in production an AWS KMS HMAC CMK referenced
 * by `AWS_KMS_MAC_KEY_ID_OAUTH_SALT`. See
 * `apps/web/src/lib/auth/oauth-salt.ts` and
 * `docs/operations/kms-signer-setup.md` § "OAuth salt MAC key (S2.6)".
 *
 * The function is async because `kms:GenerateMac` is a network call in
 * production; the local-hmac dev path resolves synchronously but returns
 * a Promise for interface parity.
 */
export async function deriveSaltFromEmail(email: string, rotation: number = 0): Promise<bigint> {
  return deriveOauthSaltBigInt(email, rotation)
}

/** Stable DID for a Google identity (used as users.did / JWT sub). */
export function googleDid(sub: string): string {
  return `did:google:${sub}`
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
