/**
 * HCP Vault Transit `A2AKeyProvider` (KMS migration K2 — primary prod backend).
 *
 * Implements `A2AKeyProvider` against HashiCorp Vault's Transit secrets engine
 * over plain HTTP. Per `KMS-IMPLEMENTATION-PLAN.md` §3.2:
 *
 *   - `generateSessionDataKey` → `POST /v1/transit/datakey/plaintext/<key>`
 *   - `decryptSessionDataKey`  → `POST /v1/transit/decrypt/<key>`
 *
 * The context tuple from the K0+K1 contract is base64-encoded canonical bytes
 * (`canonicalContextBytes` from `./types`) and passed as Vault's `context`
 * parameter — Vault refuses the decrypt unless the context matches what was
 * used at datakey-generation time. That's the second of two independent
 * trip-wires (the first is the AES-GCM AAD in `apps/a2a-agent/src/auth/encryption.ts`).
 *
 * Why no `node-vault` / `@hashicorp/vault-client` / `@vercel/oidc` dep:
 *
 *   - Vault's HTTP API is a half-dozen well-documented JSON endpoints. A 200-line
 *     `fetch()`-based client is easier to audit than a 100k-line dep tree.
 *   - The Vercel OIDC token discovery shifts to a request-scope reader if and
 *     when a2a-agent is ever deployed as a Vercel Function. For the long-running
 *     Hono-server case (today's a2a-agent), `process.env.VERCEL_OIDC_TOKEN` is
 *     sufficient and lives in a separate single-responsibility module
 *     (`apps/a2a-agent/src/auth/vault-oidc-token-exchange.ts`) so the substrate
 *     shift is a one-file change.
 *
 * Vault token lifecycle:
 *
 *   - On first use, `POST /v1/auth/oidc/login` exchanges the Vercel OIDC JWT
 *     for a Vault session token. Response includes `auth.client_token` and
 *     `auth.lease_duration` (seconds).
 *   - Token is cached in module-private memory. Renewed when remaining
 *     lease < `RENEW_BEFORE_SEC`.
 *   - On HCP, every Vault request also carries `X-Vault-Namespace`.
 *   - Tokens are NEVER logged and NEVER persisted to disk.
 *
 * Error mapping (`KMS-IMPLEMENTATION-PLAN.md` §3.2):
 *
 *   - HTTP 403   → "vault unauthorized" (also the context-mismatch surface for decrypt)
 *   - HTTP 404   → "vault key not found"
 *   - HTTP 401   → expired token; re-authenticate once then retry; second 401 surfaces
 *   - HTTP 5xx   → "vault server error: <status>"
 *   - timeout/network → "vault unreachable"
 *
 * Plaintext data keys live in heap only for the duration of the encrypt/decrypt
 * call. Zeroising is the CALLER'S responsibility — `apps/a2a-agent/src/auth/encryption.ts`
 * already does it in `finally` per the K0+K1 contract.
 */
import type { A2AKeyProvider } from './types'
import { canonicalContextBytes } from './types'

/**
 * Environment for `createVaultTransitProvider`.
 *
 * - `VAULT_ADDR`        — base URL of the Vault cluster.
 *                         E.g. `https://<cluster>.hashicorp.cloud:8200`.
 * - `VAULT_NAMESPACE`   — Vault namespace (HCP usually requires `admin`).
 *                         Optional; self-hosted Vault typically omits this.
 * - `VAULT_TRANSIT_KEY` — name of the transit key. E.g. `smart-agent-session-encryption`.
 * - `VAULT_OIDC_ROLE`   — name of the OIDC role bound to the Vercel issuer.
 *                         E.g. `smart-agent-a2a`.
 */
export interface VaultTransitEnv {
  VAULT_ADDR: string
  VAULT_NAMESPACE?: string
  VAULT_TRANSIT_KEY: string
  VAULT_OIDC_ROLE: string
}

/**
 * Optional dependencies (test-injectable). In production callers use the
 * default exports; tests inject a `fetch` stub and an OIDC-token getter.
 */
export interface VaultTransitDeps {
  /** Override `globalThis.fetch` for tests. */
  fetch?: typeof fetch
  /**
   * Vercel OIDC token discovery. Production callers pass the
   * `getVercelOidcToken` import from `vault-oidc-token-exchange.ts`.
   * Tests inject a stub returning a known JWT.
   */
  getOidcToken?: () => string
  /**
   * Time source for token-cache expiry checks. Defaults to `Date.now`.
   * Tests inject a fake clock to assert renewal behaviour.
   */
  now?: () => number
}

const REQUEST_TIMEOUT_MS = 5000
const RENEW_BEFORE_SEC = 60
const VAULT_CIPHERTEXT_PREFIX = 'vault:'

interface VaultLoginResponse {
  auth?: {
    client_token?: string
    lease_duration?: number
  }
}

interface VaultDataKeyResponse {
  data?: {
    plaintext?: string  // base64 of 32-byte AES key
    ciphertext?: string // "vault:vN:base64..."
  }
}

interface VaultDecryptResponse {
  data?: {
    plaintext?: string  // base64 of 32-byte AES key
  }
}

interface CachedToken {
  token: string
  expiresAtMs: number
}

/**
 * Default Vercel OIDC token getter — reads `process.env.VERCEL_OIDC_TOKEN`.
 * Throws if absent so a misconfigured deployment fails closed.
 *
 * Used when the caller does not inject `deps.getOidcToken`. In a2a-agent
 * production code this default should NOT be relied on — the caller imports
 * from `apps/a2a-agent/src/auth/vault-oidc-token-exchange.ts` so the
 * env-var-vs-request-scope decision is a one-file change.
 */
function defaultGetOidcToken(): string {
  const token = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.VERCEL_OIDC_TOKEN
  if (!token) {
    throw new Error(
      'vault-transit-provider: VERCEL_OIDC_TOKEN env var is required (Vault OIDC login)',
    )
  }
  return token
}

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function base64Encode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function base64Decode(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function utf8Decode(b: Uint8Array): string {
  return new TextDecoder().decode(b)
}

/**
 * Parse the integer key version from a Vault transit ciphertext.
 * Vault ciphertext format: `vault:vN:base64...` where N is the key version.
 * Returns the string form to match the `A2AKeyProvider.keyVersion: string`
 * contract; callers that need an integer can `parseInt`.
 */
function parseKeyVersion(ciphertext: string): string {
  if (!ciphertext.startsWith(VAULT_CIPHERTEXT_PREFIX)) {
    throw new Error(`vault-transit-provider: unexpected ciphertext format (missing vault: prefix)`)
  }
  const parts = ciphertext.split(':')
  if (parts.length < 3 || !parts[1] || !parts[1].startsWith('v')) {
    throw new Error(`vault-transit-provider: cannot parse keyVersion from ciphertext`)
  }
  const v = parts[1].slice(1)
  if (!/^\d+$/.test(v)) {
    throw new Error(`vault-transit-provider: keyVersion suffix is not numeric: ${parts[1]}`)
  }
  return v
}

/**
 * Create the Vault Transit `A2AKeyProvider`.
 *
 * Validates env synchronously; does NOT contact Vault until the first
 * `generateSessionDataKey` / `decryptSessionDataKey` call. This keeps the
 * module-load order identical between long-running servers and Vercel
 * Function cold-starts.
 */
export function createVaultTransitProvider(
  env: VaultTransitEnv,
  deps: VaultTransitDeps = {},
): A2AKeyProvider {
  if (!env.VAULT_ADDR || !isValidHttpUrl(env.VAULT_ADDR)) {
    throw new Error(`createVaultTransitProvider: VAULT_ADDR must be a valid http(s) URL`)
  }
  if (!env.VAULT_TRANSIT_KEY) {
    throw new Error(`createVaultTransitProvider: VAULT_TRANSIT_KEY is required`)
  }
  if (!env.VAULT_OIDC_ROLE) {
    throw new Error(`createVaultTransitProvider: VAULT_OIDC_ROLE is required`)
  }

  // Normalise base URL (strip trailing slash).
  const baseUrl = env.VAULT_ADDR.replace(/\/+$/, '')
  const fetchFn = deps.fetch ?? globalThis.fetch
  const getOidcToken = deps.getOidcToken ?? defaultGetOidcToken
  const now = deps.now ?? Date.now

  let cachedToken: CachedToken | null = null

  function namespaceHeader(): Record<string, string> {
    return env.VAULT_NAMESPACE ? { 'X-Vault-Namespace': env.VAULT_NAMESPACE } : {}
  }

  async function vaultFetch(path: string, init: RequestInit): Promise<Response> {
    const url = `${baseUrl}${path}`
    let res: Response
    try {
      res = await fetchFn(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      // AbortError / network error / DNS failure all surface as the same
      // operational class — Vault is unreachable.
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`vault unreachable: ${msg}`)
    }
    return res
  }

  /**
   * Exchange the Vercel OIDC token for a Vault session token via the OIDC
   * auth method. Caches the result, renewing when < RENEW_BEFORE_SEC remain.
   */
  async function loginToVault(): Promise<string> {
    const oidcToken = getOidcToken()
    const res = await vaultFetch('/v1/auth/oidc/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...namespaceHeader() },
      body: JSON.stringify({ role: env.VAULT_OIDC_ROLE, jwt: oidcToken }),
    })
    if (!res.ok) {
      if (res.status === 403) throw new Error('vault unauthorized: OIDC login rejected')
      if (res.status === 404) throw new Error('vault unauthorized: OIDC role not found')
      if (res.status >= 500) throw new Error(`vault server error: ${res.status}`)
      throw new Error(`vault unauthorized: OIDC login failed (${res.status})`)
    }
    let body: VaultLoginResponse
    try {
      body = (await res.json()) as VaultLoginResponse
    } catch {
      throw new Error('vault unauthorized: malformed OIDC login response')
    }
    const token = body.auth?.client_token
    const lease = body.auth?.lease_duration
    if (!token || typeof lease !== 'number') {
      throw new Error('vault unauthorized: missing client_token / lease_duration')
    }
    const expiresAtMs = now() + lease * 1000
    cachedToken = { token, expiresAtMs }
    return token
  }

  async function getVaultToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && cachedToken) {
      const remainingMs = cachedToken.expiresAtMs - now()
      if (remainingMs > RENEW_BEFORE_SEC * 1000) {
        return cachedToken.token
      }
    }
    return loginToVault()
  }

  /**
   * One Vault-API request with automatic 401 re-auth-and-retry. We do NOT
   * retry on 403 (that includes context-mismatch — re-auth would not help)
   * or on 5xx (caller decides).
   */
  async function transitFetch(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    let token = await getVaultToken()
    let res = await vaultFetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vault-Token': token,
        ...namespaceHeader(),
      },
      body: JSON.stringify(body),
    })
    if (res.status === 401) {
      // Token expired between cache-check and request. Force a re-auth
      // and retry exactly once.
      cachedToken = null
      token = await getVaultToken(true)
      res = await vaultFetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Vault-Token': token,
          ...namespaceHeader(),
        },
        body: JSON.stringify(body),
      })
    }
    return res
  }

  function mapTransitError(res: Response, op: string): Error {
    if (res.status === 403) return new Error(`vault unauthorized (${op})`)
    if (res.status === 404) return new Error(`vault key not found (${op})`)
    if (res.status === 401) return new Error(`vault unauthorized (${op}): token rejected after retry`)
    if (res.status >= 500) return new Error(`vault server error: ${res.status} (${op})`)
    return new Error(`vault error: ${res.status} (${op})`)
  }

  return {
    async generateSessionDataKey({ aadContext }) {
      const ctxBytes = canonicalContextBytes(aadContext)
      const ctxB64 = ctxBytes.length > 0 ? base64Encode(ctxBytes) : ''
      const path = `/v1/transit/datakey/plaintext/${encodeURIComponent(env.VAULT_TRANSIT_KEY)}`
      const res = await transitFetch(path, ctxB64 ? { context: ctxB64 } : {})
      if (!res.ok) throw mapTransitError(res, 'datakey')
      let body: VaultDataKeyResponse
      try {
        body = (await res.json()) as VaultDataKeyResponse
      } catch {
        throw new Error('vault error: malformed datakey response')
      }
      const plaintextB64 = body.data?.plaintext
      const ciphertext = body.data?.ciphertext
      if (!plaintextB64 || !ciphertext) {
        throw new Error('vault error: datakey response missing plaintext or ciphertext')
      }
      const plaintextDataKey = base64Decode(plaintextB64)
      if (plaintextDataKey.length !== 32) {
        // Zero the bad-key bytes before throwing so they don't linger in the
        // error path heap snapshot.
        for (let i = 0; i < plaintextDataKey.length; i++) plaintextDataKey[i] = 0
        throw new Error(`vault error: data key must be 32 bytes (got ${plaintextDataKey.length})`)
      }
      return {
        plaintextDataKey,
        encryptedDataKey: utf8Encode(ciphertext),
        keyId: env.VAULT_TRANSIT_KEY,
        keyVersion: parseKeyVersion(ciphertext),
      }
    },

    async decryptSessionDataKey({ encryptedDataKey, aadContext, keyId, keyVersion }) {
      if (keyId !== env.VAULT_TRANSIT_KEY) {
        throw new Error(
          `vault-transit provider: keyId mismatch (expected '${env.VAULT_TRANSIT_KEY}', got '${keyId}')`,
        )
      }
      const ciphertext = utf8Decode(encryptedDataKey)
      if (!ciphertext.startsWith(VAULT_CIPHERTEXT_PREFIX)) {
        throw new Error('vault-transit provider: encryptedDataKey is not a Vault ciphertext')
      }
      const onWireVersion = parseKeyVersion(ciphertext)
      if (onWireVersion !== keyVersion) {
        throw new Error(
          `vault-transit provider: keyVersion mismatch (expected '${keyVersion}', wire '${onWireVersion}')`,
        )
      }
      const ctxBytes = canonicalContextBytes(aadContext)
      const ctxB64 = ctxBytes.length > 0 ? base64Encode(ctxBytes) : ''
      const path = `/v1/transit/decrypt/${encodeURIComponent(env.VAULT_TRANSIT_KEY)}`
      const reqBody: Record<string, unknown> = { ciphertext }
      if (ctxB64) reqBody.context = ctxB64
      const res = await transitFetch(path, reqBody)
      if (!res.ok) throw mapTransitError(res, 'decrypt')
      let body: VaultDecryptResponse
      try {
        body = (await res.json()) as VaultDecryptResponse
      } catch {
        throw new Error('vault error: malformed decrypt response')
      }
      const plaintextB64 = body.data?.plaintext
      if (!plaintextB64) {
        throw new Error('vault error: decrypt response missing plaintext')
      }
      const plaintextDataKey = base64Decode(plaintextB64)
      if (plaintextDataKey.length !== 32) {
        for (let i = 0; i < plaintextDataKey.length; i++) plaintextDataKey[i] = 0
        throw new Error(`vault error: decrypted key must be 32 bytes (got ${plaintextDataKey.length})`)
      }
      return plaintextDataKey
    },
  }
}
