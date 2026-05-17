/**
 * Server-side WalletActionV1 dispatch.
 *
 * Phase 3 of A2A+MCP consolidation — every step now flows through
 * a2a-agent. The web app no longer opens a direct PERSON_MCP_URL
 * connection:
 *
 *   1. Read grant cookie (session-id) → look up SessionRecord via
 *      `fetchSessionByCookie`, which routes through a2a-agent's
 *      `/session-store/by-cookie/<cookie>` passthrough.
 *   2. Re-derive the session-EOA via the configured custody backend.
 *   3. Build WalletActionV1 (canonicalized payload hash, action type, etc.).
 *   4. Sign the canonical action hash with the session-EOA.
 *   5. POST { action, signature, payload } to a2a-agent's
 *      `/wallet-action/dispatch` passthrough. Person-mcp verifies
 *      (verifyDelegatedWalletAction) AND executes.
 *
 * The WalletAction signature is the cryptographic authority that
 * person-mcp re-verifies on receipt. Hardening §1.3 (Stream B Task B1)
 * adds a defense-in-depth web→a2a HMAC envelope at the a2a edge so an
 * in-process langchain runtime (or anyone else on the loopback
 * interface) can't forge dispatches without going through the web app.
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
import { toBase64Url, buildWebMacProvider, type KmsMacProvider } from '@smart-agent/sdk'
import { createHash, randomUUID } from 'node:crypto'

let cachedDispatchMacProvider: KmsMacProvider | null = null
function dispatchMacProvider(): KmsMacProvider {
  if (!cachedDispatchMacProvider) {
    cachedDispatchMacProvider = buildWebMacProvider(process.env)
  }
  return cachedDispatchMacProvider
}

function a2aBaseUrl(): string {
  // System-scoped passthrough — no host-based routing. Hit the bare
  // loopback host directly. Avoids Node-fetch ENOTFOUND on
  // `agent.localhost` (undici's resolver can't follow the *.localhost
  // spec).
  return process.env.A2A_AGENT_URL ?? 'http://127.0.0.1:3100'
}

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

  // 5. Dispatch through a2a-agent's `/wallet-action/dispatch` passthrough.
  //    Person-mcp re-verifies the action signature on receipt. The a2a
  //    edge also verifies the web→a2a HMAC envelope (Hardening §1.3 /
  //    Stream B Task B1) — defense-in-depth against an in-process
  //    langchain runtime forging dispatches.
  const dispatchPath = '/wallet-action/dispatch'
  const bodyJson = JSON.stringify({
    action,
    actionSignature: signature,
    sessionId: session.sessionId,
    payload: input.payload,
  })
  const headers = await dispatchSignedHeaders(dispatchPath, bodyJson)
  const res = await fetch(`${a2aBaseUrl()}${dispatchPath}`, {
    method: 'POST',
    headers,
    body: bodyJson,
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

/**
 * Sign a web → a2a-agent service-auth envelope for the wallet-action
 * dispatch path. Mirrors the same canonical-string format as
 * `apps/a2a-agent/src/auth/service-auth-web.ts::buildWebCanonical`.
 */
async function dispatchSignedHeaders(path: string, bodyJson: string): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = randomUUID()
  const bodyHash = createHash('sha256').update(bodyJson, 'utf8').digest('hex')
  const canonical = `${timestamp}|${nonce}|${path}|${bodyHash}`
  const canonicalMessage = new TextEncoder().encode(canonical)
  const { mac } = await dispatchMacProvider().generateMac({ canonicalMessage })
  const signature = toBase64Url(mac)
  return {
    'content-type': 'application/json',
    'x-sa-service': 'web',
    'x-sa-timestamp': String(timestamp),
    'x-sa-nonce': nonce,
    'x-sa-signature': signature,
  }
}
