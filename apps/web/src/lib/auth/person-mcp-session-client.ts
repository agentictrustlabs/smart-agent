/**
 * Client for person-mcp's SessionRecord storage.
 *
 * Routing: every operation flows through a2a-agent's `/session-store/*`
 * passthrough (Phase 2 of A2A+MCP consolidation + Hardening §1.3 Stream
 * B Task B1). The web app does NOT open a direct PERSON_MCP_URL
 * connection for any session-store operation — person-mcp remains the
 * storage owner, a2a-agent forwards untouched.
 *
 * Hardening §1.3 (Stream B Task B1): the WRITE routes (`/insert`,
 * `/revoke`, `/bump-epoch`) carry a signed envelope verified at the a2a
 * edge via `requireServiceAuth('web')`. The web app signs every write
 * with `WEB_TO_A2A_HMAC_KEY` over a canonical string that includes the
 * timestamp, fresh per-request nonce, request path, and sha256 of the
 * body. The READ routes (`/epoch/:account`, `/by-cookie/:cookieValue`,
 * `/active/:account`) are unauthenticated at the a2a edge for now —
 * they're read-only and idempotent; the broader route-classification
 * sweep in Phase 1B will give them their own service-auth tier.
 *
 * Hardening §1.3 (Stream B Task B3): `insertSessionRecord` also threads
 * the just-completed passkey assertion through to person-mcp so the
 * storage owner can re-verify the ERC-1271 signature against the smart
 * account BEFORE writing the row.
 */

import { toBase64Url } from '@smart-agent/sdk'
import { buildWebMacProvider, type KmsMacProvider } from '@smart-agent/sdk/key-custody'
import { createHash, randomUUID } from 'node:crypto'
import type { SessionRecord } from '@smart-agent/privacy-creds/session-grant'

let cachedMacProvider: KmsMacProvider | null = null
function macProvider(): KmsMacProvider {
  if (!cachedMacProvider) {
    cachedMacProvider = buildWebMacProvider(process.env)
  }
  return cachedMacProvider
}

function a2aBaseUrl(): string {
  // Internal-only — the session-store passthrough is system-scoped (no
  // host-based routing needed). Use A2A_AGENT_URL which points at the
  // bare loopback host. Avoids the Node-fetch ENOTFOUND on
  // `agent.localhost` (undici's resolver can't follow the *.localhost
  // spec the way curl/libcurl does).
  return process.env.A2A_AGENT_URL ?? 'http://127.0.0.1:3100'
}

/**
 * Build signed headers for the web → a2a-agent service-auth envelope
 * (Hardening §1.3 / Task B1). Mirrors
 * `apps/a2a-agent/src/auth/service-auth-web.ts::buildWebCanonical`:
 *
 *   canonical = `${ts}|${nonce}|${path}|${sha256_hex(body)}`
 *
 * `path` is the request path portion only (no host, no query).
 */
async function signedHeadersFor(path: string, bodyJson: string): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = randomUUID()
  const bodyHash = createHash('sha256').update(bodyJson, 'utf8').digest('hex')
  const canonical = `${timestamp}|${nonce}|${path}|${bodyHash}`
  const canonicalMessage = new TextEncoder().encode(canonical)
  const { mac } = await macProvider().generateMac({ canonicalMessage })
  const signature = toBase64Url(mac)
  return {
    'content-type': 'application/json',
    'x-sa-service': 'web',
    'x-sa-timestamp': String(timestamp),
    'x-sa-nonce': nonce,
    'x-sa-signature': signature,
  }
}

export async function fetchRevocationEpoch(account: `0x${string}`): Promise<number> {
  const res = await fetch(`${a2aBaseUrl()}/session-store/epoch/${account}`)
  if (!res.ok) throw new Error(`epoch fetch failed: ${res.status}`)
  const data = await res.json() as { epoch: number }
  return data.epoch
}

/**
 * Passkey assertion bundle the web's /session-grant/finalize route just
 * verified locally — person-mcp re-verifies the SAME assertion via
 * ERC-1271 against the smart account before writing the row (Task B3).
 *
 * `serverNonce` is the random bytes that anchored the original
 * challenge `sha256("SessionGrant:v1" || grantHash || serverNonce)`.
 * Person-mcp reconstructs the challenge from `record.grantHash` plus
 * this nonce and verifies that the passkey signed it. Without this
 * bundle, person-mcp's verifier rejects the insert.
 */
export interface InsertPasskeyAssertion {
  credentialIdBase64Url: string
  authenticatorDataBase64Url: string
  clientDataJSONBase64Url: string
  signatureBase64Url: string
  serverNonce: string
}

export async function insertSessionRecord(
  record: SessionRecord,
  passkeyAssertion?: InsertPasskeyAssertion,
): Promise<void> {
  const wire = {
    sessionId: record.sessionId,
    sessionIdHash: record.sessionIdHash,
    smartAccountAddress: record.smartAccountAddress,
    sessionSignerAddress: record.sessionSignerAddress,
    verifiedPasskeyPubkey: record.verifiedPasskeyPubkey,
    grant: record.grant,
    grantHash: record.grantHash,
    idleExpiresAtMs: record.idleExpiresAt.getTime(),
    expiresAtMs: record.expiresAt.getTime(),
    createdAtMs: record.createdAt.getTime(),
    revocationEpoch: record.revocationEpoch,
  }
  const path = '/session-store/insert'
  const payload: Record<string, unknown> = { record: wire }
  if (passkeyAssertion) {
    payload.passkeyAssertion = passkeyAssertion
  }
  const bodyJson = JSON.stringify(payload)
  const headers = await signedHeadersFor(path, bodyJson)
  const res = await fetch(`${a2aBaseUrl()}${path}`, {
    method: 'POST',
    headers,
    body: bodyJson,
  })
  if (!res.ok) throw new Error(`session insert failed: ${res.status} ${await res.text()}`)
}

export async function fetchSessionByCookie(cookieValue: string): Promise<SessionRecord | null> {
  const res = await fetch(`${a2aBaseUrl()}/session-store/by-cookie/${encodeURIComponent(cookieValue)}`)
  if (!res.ok) return null
  const data = await res.json() as { record: SessionRecord | null }
  return data.record
}

export async function listActiveSessions(account: `0x${string}`): Promise<SessionRecord[]> {
  const res = await fetch(`${a2aBaseUrl()}/session-store/active/${account}`)
  if (!res.ok) return []
  const data = await res.json() as { records: SessionRecord[] }
  return data.records
}

export async function revokeSessionByCookie(sessionId: string): Promise<void> {
  const path = '/session-store/revoke'
  const bodyJson = JSON.stringify({ sessionId })
  const headers = await signedHeadersFor(path, bodyJson)
  await fetch(`${a2aBaseUrl()}${path}`, {
    method: 'POST',
    headers,
    body: bodyJson,
  })
}

export async function bumpRevocationEpoch(account: `0x${string}`): Promise<number> {
  const path = '/session-store/bump-epoch'
  const bodyJson = JSON.stringify({ smartAccountAddress: account })
  const headers = await signedHeadersFor(path, bodyJson)
  const res = await fetch(`${a2aBaseUrl()}${path}`, {
    method: 'POST',
    headers,
    body: bodyJson,
  })
  if (!res.ok) throw new Error(`bump-epoch failed: ${res.status}`)
  const data = await res.json() as { epoch: number }
  return data.epoch
}
