/**
 * Outbound HMAC envelope signer for a2a-agent → downstream MCP hops
 * (Sprint 1 W2.1).
 *
 * Symmetric counterpart to `service-auth-web.ts`: when a2a-agent
 * forwards a request to person-mcp (or any future MCP), it must sign
 * the envelope with the same MAC key the downstream verifier expects.
 * The canonical-string and header layout matches the inbound verifier
 * on the other end of the wire:
 *
 *   X-SA-Service:   a2a-agent
 *   X-SA-Timestamp: <unix seconds>
 *   X-SA-Nonce:     <fresh-per-request>
 *   X-SA-Signature: <base64url MAC>
 *
 *   canonical = `${ts}|${nonce}|${path}|${sha256(body)}`
 *
 * `path` is the request path on the downstream service (no host, no
 * query) so a captured signature for `/session-store/insert` cannot be
 * replayed against `/session-store/revoke`. `sha256(body)` is the
 * lowercase hex digest of the raw body bytes (empty string for empty
 * bodies).
 *
 * This is the SIGNING half of the same envelope; person-mcp's
 * `apps/person-mcp/src/auth/require-inbound-service-auth.ts` verifies
 * it. Both ends use the `a2a-to-person` MAC key id (HMAC is symmetric).
 */

import { toBase64Url } from '@smart-agent/sdk'
import { createHash, randomUUID } from 'node:crypto'
import { defaultMacProviderCache, type MacKeyId } from './mac-provider'

export const OUTBOUND_SERVICE_HEADER = 'x-sa-service'
export const OUTBOUND_TIMESTAMP_HEADER = 'x-sa-timestamp'
export const OUTBOUND_NONCE_HEADER = 'x-sa-nonce'
export const OUTBOUND_SIGNATURE_HEADER = 'x-sa-signature'

/** Hex SHA-256 of the raw request body — bound into the canonical string. */
function sha256Hex(bodyRaw: string): string {
  return createHash('sha256').update(bodyRaw, 'utf8').digest('hex')
}

/** Canonical message both sides sign over. Matches the inbound verifier. */
export function buildOutboundCanonical(
  timestamp: number | string,
  nonce: string,
  path: string,
  bodyRaw: string,
): string {
  return `${timestamp}|${nonce}|${path}|${sha256Hex(bodyRaw)}`
}

/**
 * Build the four HMAC envelope headers for a signed outbound request
 * from a2a-agent to the given downstream MAC key. Caller is responsible
 * for placing these alongside any `content-type` / `X-SA-Correlation-Id`
 * header they care to propagate.
 *
 * @param macKeyId  The downstream MAC key id (e.g. 'a2a-to-person').
 * @param path      The path on the downstream service (no host, no query).
 * @param bodyRaw   The exact bytes that will be sent as the request body.
 */
export async function buildOutboundAuthHeaders(
  macKeyId: MacKeyId,
  path: string,
  bodyRaw: string,
): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = randomUUID()
  const canonical = buildOutboundCanonical(timestamp, nonce, path, bodyRaw)
  const canonicalMessage = new TextEncoder().encode(canonical)
  const { mac } = await defaultMacProviderCache.get(macKeyId).generateMac({ canonicalMessage })
  return {
    [OUTBOUND_SERVICE_HEADER]: 'a2a-agent',
    [OUTBOUND_TIMESTAMP_HEADER]: String(timestamp),
    [OUTBOUND_NONCE_HEADER]: nonce,
    [OUTBOUND_SIGNATURE_HEADER]: toBase64Url(mac),
  }
}
