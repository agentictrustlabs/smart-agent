/**
 * Client for person-mcp's SessionRecord HTTP API.
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
