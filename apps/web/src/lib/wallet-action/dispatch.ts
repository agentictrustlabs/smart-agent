/**
 * Server-side WalletActionV1 dispatch.
 *
 * Replaces the legacy passkey-prompted flow (signWalletActionClient +
 * submitWalletProvision/store/present) with a single server-side path:
 *
 *   1. Read grant cookie (session-id) → look up SessionRecord on person-mcp.
 *   2. Re-derive the session-EOA via the configured custody backend.
 *   3. Build WalletActionV1 (canonicalized payload hash, action type, etc.).
 *   4. Sign the canonical action hash with the session-EOA.
 *   5. POST { action, signature, payload } to person-mcp /wallet-action/dispatch.
 *      Person-mcp verifies (verifyDelegatedWalletAction) AND executes.
 *
 * No passkey prompt. No client-side keys. The user already proved consent
 * by signing the SessionGrant at signin (design doc §3.4 audit C3).
 */

import { cookies } from 'next/headers'
import {
  hashCanonical,
  type SessionWalletActionType,
  type WalletActionV1,
} from '@smart-agent/privacy-creds/session-grant'
import { grantCookieName } from '@/lib/auth/session-cookie'
import { fetchSessionByCookie } from '@/lib/auth/person-mcp-session-client'
import { getKeyCustody } from '@/lib/key-custody'
import { randomUUID } from 'node:crypto'

const PERSON_MCP_URL = process.env.PERSON_MCP_URL ?? 'http://localhost:3200'

export class DispatchError extends Error {
  constructor(public readonly code: string, public readonly status: number, public readonly detail: string) {
    super(`${code}: ${detail}`)
  }
}

export interface DispatchInput {
  /** Action type — MUST be in the grant's scope.walletActions. */
  actionType: SessionWalletActionType
  /** The actual operation params; canonicalized + hashed into the action. */
  payload: Record<string, unknown>
  /** Target service receiving this action. Verifier checks audience match. */
  service: string
  /** Optional verifier ID for CreatePresentation (DID or domain). */
  verifierDid?: string
  verifierDomain?: string
}

export async function dispatchWalletAction<T = unknown>(input: DispatchInput): Promise<T> {
  // 1. Read grant cookie.
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(grantCookieName())?.value
  if (!cookieValue) {
    throw new DispatchError('no_session', 401, 'no session-grant cookie present')
  }

  const session = await fetchSessionByCookie(cookieValue)
  if (!session) {
    throw new DispatchError('unknown_session', 401, 'cookie does not match any SessionRecord')
  }

  // 2. Derive session-EOA. The address must match what the grant committed
  //    to; if it doesn't, the verifier rejects with delegate_mismatch.
  const custody = getKeyCustody()

  // 3. Build the canonical payload hash.
  const payloadHash = hashCanonical(input.payload as unknown as Parameters<typeof hashCanonical>[0])

  const now = Date.now()
  const action: WalletActionV1 = {
    schema: 'WalletAction.v1',
    actionId: randomUUID(),
    sessionId: session.sessionId,
    actor: {
      smartAccountAddress: session.smartAccountAddress,
      sessionSignerAddress: session.sessionSignerAddress,
    },
    action: {
      type: input.actionType,
      payloadHash,
      payloadCanonicalization: 'json-c14n-v1',
    },
    audience: {
      service: input.service,
      ...(input.verifierDid ? { verifierDid: input.verifierDid } : {}),
      ...(input.verifierDomain ? { verifierDomain: input.verifierDomain } : {}),
    },
    timing: {
      createdAt: now,
      expiresAt: now + 2 * 60 * 1000,  // 2 min default action window
    },
    replayProtection: {
      actionNonce: randomUUID(),
    },
  }

  // 4. Sign the canonical action hash.
  const actionHash = hashCanonical(action as unknown as Parameters<typeof hashCanonical>[0])
  const { signature, address } = await custody.signWithDerivedSigner(session.sessionId, actionHash as `0x${string}`)
  if (address.toLowerCase() !== session.sessionSignerAddress.toLowerCase()) {
    throw new DispatchError('signer_drift', 500, `derived ${address} but session expects ${session.sessionSignerAddress}`)
  }

  // 5. Dispatch to person-mcp.
  const res = await fetch(`${PERSON_MCP_URL}/wallet-action/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action,
      actionSignature: signature,
      sessionId: session.sessionId,
      payload: input.payload,
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { code?: string; detail?: string; error?: string }
    throw new DispatchError(
      body.code ?? 'dispatch_failed',
      res.status,
      body.detail ?? body.error ?? `HTTP ${res.status}`,
    )
  }

  return await res.json() as T
}
