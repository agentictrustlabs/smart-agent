/**
 * Client for person-mcp's SessionRecord HTTP API.
 *
 * Routing rule (phase 3 of A2A-first consolidation):
 *   - Every function in this file currently performs a direct HTTP call
 *     against person-mcp's non-`/tools/` `/session-store/*` routes
 *     (`/epoch/<addr>`, `/insert`, `/by-cookie/<value>`, `/active/<addr>`,
 *     `/revoke`, `/bump-epoch`). These are part of person-mcp's Hono app
 *     but live OUTSIDE the MCP tool surface, so the A2A proxy at
 *     `/mcp/<server>/<tool>` cannot currently target them.
 *   - TODO(phase-4): person-mcp owner should expose this state through
 *     MCP tools (e.g. `ssi_session_epoch`, `ssi_session_insert`,
 *     `ssi_session_by_cookie`, `ssi_session_list_active`,
 *     `ssi_session_revoke`, `ssi_session_bump_epoch`) so this entire
 *     module can flip to `callMcp('person', …)`. Tracked as the last
 *     PERSON_MCP_URL holdout in apps/web/src/lib/auth/.
 *   - Some entry points (`fetchSessionByCookie`) intentionally key off
 *     a cookie value that the A2A proxy's per-session auth path doesn't
 *     yet know how to forward — wrapping those tools also requires
 *     extending the A2A delegation-token contract to carry the cookie's
 *     opaque session id. Phase 4 should design that.
 *
 * Person-mcp owns the canonical session/revocation/audit state. The web
 * app reads/writes through these endpoints instead of touching SQLite
 * directly — keeps a single owner per design doc §5.
 */

import type { SessionRecord } from '@smart-agent/privacy-creds/session-grant'

function baseUrl(): string {
  return process.env.PERSON_MCP_URL ?? 'http://localhost:3200'
}

export async function fetchRevocationEpoch(account: `0x${string}`): Promise<number> {
  const res = await fetch(`${baseUrl()}/session-store/epoch/${account}`)
  if (!res.ok) throw new Error(`epoch fetch failed: ${res.status}`)
  const data = await res.json() as { epoch: number }
  return data.epoch
}

export async function insertSessionRecord(record: SessionRecord): Promise<void> {
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
  const res = await fetch(`${baseUrl()}/session-store/insert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ record: wire }),
  })
  if (!res.ok) throw new Error(`session insert failed: ${res.status} ${await res.text()}`)
}

export async function fetchSessionByCookie(cookieValue: string): Promise<SessionRecord | null> {
  const res = await fetch(`${baseUrl()}/session-store/by-cookie/${encodeURIComponent(cookieValue)}`)
  if (!res.ok) return null
  const data = await res.json() as { record: SessionRecord | null }
  return data.record
}

export async function listActiveSessions(account: `0x${string}`): Promise<SessionRecord[]> {
  const res = await fetch(`${baseUrl()}/session-store/active/${account}`)
  if (!res.ok) return []
  const data = await res.json() as { records: SessionRecord[] }
  return data.records
}

export async function revokeSessionByCookie(sessionId: string): Promise<void> {
  await fetch(`${baseUrl()}/session-store/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })
}

export async function bumpRevocationEpoch(account: `0x${string}`): Promise<number> {
  const res = await fetch(`${baseUrl()}/session-store/bump-epoch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ smartAccountAddress: account }),
  })
  if (!res.ok) throw new Error(`bump-epoch failed: ${res.status}`)
  const data = await res.json() as { epoch: number }
  return data.epoch
}
