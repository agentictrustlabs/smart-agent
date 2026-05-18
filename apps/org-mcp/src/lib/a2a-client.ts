/**
 * Org-mcp ↔ a2a-agent inter-service client.
 *
 * Signs requests with the `a2a-to-org` HMAC key so a2a-agent's privileged
 * session endpoints can verify the caller is an enrolled MCP server.
 *
 * Under Option A (ERC-4337-only redeem) every on-chain write a tool makes
 * goes through a SINGLE a2a endpoint:
 *
 *   POST /session/:id/redeem-via-account
 *
 * The endpoint accepts an optional `chain` field for the AnonCreds-gated
 * admin→holder→smartAccount marketplace flow; when absent, it falls back
 * to the session's own stored root delegation. Sensitive-tier sub-
 * delegations (formerly `/redeem-subdelegated`) now build the per-call
 * `D_sub` off-chain and pass it as a 2-element `chain` in the same body.
 *
 * The user-delegation bearer token is a SEPARATE auth plane and is handled
 * by mcp-proxy when MCP calls arrive. Inter-service auth proves the MCP
 * server's identity to a2a-agent; user-delegation auth proves the user's
 * authorization to the MCP server.
 *
 * After KMS migration K3-extension, signing routes through
 * `buildMcpMacProvider('org', ...)` which uses AWS KMS `kms:GenerateMac`
 * against the `a2a-to-org` HMAC key in production (or the local-hmac dev
 * provider reading `A2A_INTERSERVICE_HMAC_KEY_ORG` in dev). The canonical
 * message format is UNCHANGED.
 */
import { toBase64Url } from '@smart-agent/sdk'
import { buildMcpMacProvider, type KmsMacProvider } from '@smart-agent/sdk/key-custody'
import { createHash, randomUUID } from 'node:crypto'
import type { Address, Hex } from 'viem'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://127.0.0.1:3100'
const SERVICE_NAME = 'org-mcp'

let cachedMacProvider: KmsMacProvider | null = null
function macProvider(): KmsMacProvider {
  if (!cachedMacProvider) {
    cachedMacProvider = buildMcpMacProvider('org', process.env)
  }
  return cachedMacProvider
}

/** Hex SHA-256 of the raw body bytes — bound into the canonical string. */
function sha256Hex(bodyRaw: string): string {
  return createHash('sha256').update(bodyRaw, 'utf8').digest('hex')
}

async function signedFetch(
  path: string,
  _sessionId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const bodyJson = JSON.stringify(body)
  const timestamp = Math.floor(Date.now() / 1000)
  // Hardening §1.10 — fresh per-request nonce. Bound INTO the canonical
  // so a captured envelope can't be replayed within the 60s timestamp
  // window OR against a different path/body.
  const nonce = randomUUID()
  // Canonical-v2: `${ts}|${nonce}|${path}|${sha256(body)}`. Same shape
  // the web→a2a and a2a→mcp hops use. The legacy `${body}:${ts}:${sessionId}`
  // canonical did not bind the nonce → replay vulnerable. `sessionId`
  // remains indirectly bound through `path` (every inter-service route
  // is mounted under `/session/:id/<verb>`).
  const canonical = `${timestamp}|${nonce}|${path}|${sha256Hex(bodyJson)}`
  const canonicalMessage = new TextEncoder().encode(canonical)
  const { mac } = await macProvider().generateMac({ canonicalMessage })
  const signature = toBase64Url(mac)
  return fetch(`${A2A_AGENT_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': SERVICE_NAME,
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature,
      'x-a2a-nonce': nonce,
    },
    body: bodyJson,
  })
}

export interface SignedDelegation {
  delegator: Address
  delegate: Address
  authority: `0x${string}`
  caveats: Array<{ enforcer: Address; terms: Hex; args?: Hex }>
  /** Decimal or hex string. */
  salt: string
  signature: Hex
}

export interface RedeemTxRequest {
  mcpTool: string
  mcpCallId: string
  a2aTaskId?: string
  target: Address
  value: bigint
  callData: Hex
}

export interface RedeemTxResult {
  txHash: Hex
  executionReceiptId: number
  userOpHash?: Hex
  sessionAgentAccount?: Address
}

export async function callA2aRedeem(
  sessionId: string,
  req: RedeemTxRequest,
): Promise<RedeemTxResult> {
  const body = {
    mcpTool: req.mcpTool,
    mcpCallId: req.mcpCallId,
    a2aTaskId: req.a2aTaskId ?? '',
    target: req.target,
    value: req.value.toString(),
    callData: req.callData,
  }
  const res = await signedFetch(`/session/${sessionId}/redeem-via-account`, sessionId, body)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`a2a redeem failed (${res.status}): ${(err as { error?: string }).error ?? res.statusText}`)
  }
  return await res.json() as RedeemTxResult
}

export interface DeployAgentRequest {
  mcpCallId: string
  owner: Address
  salt: bigint
}

export interface DeployAgentResult {
  address: Address
  txHash: Hex
}

export async function callA2aDeployAgent(
  sessionId: string,
  req: DeployAgentRequest,
): Promise<DeployAgentResult> {
  const body = {
    mcpCallId: req.mcpCallId,
    owner: req.owner,
    salt: req.salt.toString(),
  }
  const res = await signedFetch(`/session/${sessionId}/deploy-agent`, sessionId, body)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`a2a deploy-agent failed (${res.status}): ${(err as { error?: string }).error ?? res.statusText}`)
  }
  return await res.json() as DeployAgentResult
}

// ─── Spec 004 (b2) — chained redeem ────────────────────────────────────
//
// `callA2aRedeemWithChain` instructs `/redeem-via-account` to use a
// caller-supplied delegation chain instead of the session's own stored
// root delegation. Used by AnonCreds-gated marketplace tools where the
// admin (round/pool owner) has pre-signed an `admin → holder` delegation
// at credential issuance time, and the holder's web client has freshly
// minted `holder → smartAccount` with `authority = hash(admin → holder)`
// at action time.
//
// Chain order: index 0 is the LEAF (its `delegate` must equal the
// holder's smart account = the userOp sender at the on-chain submit).
export interface RedeemWithChainRequest {
  mcpTool: string
  mcpCallId: string
  a2aTaskId?: string
  target: Address
  value: bigint
  callData: Hex
  /** Leaf first, root last. The leaf's `delegate` must equal the
   *  holder's smart account (validated server-side). */
  chain: SignedDelegation[]
}

export async function callA2aRedeemWithChain(
  sessionId: string,
  req: RedeemWithChainRequest,
): Promise<RedeemTxResult> {
  const body = {
    mcpTool: req.mcpTool,
    mcpCallId: req.mcpCallId,
    a2aTaskId: req.a2aTaskId ?? '',
    target: req.target,
    value: req.value.toString(),
    callData: req.callData,
    chain: req.chain.map((d) => ({
      delegator: d.delegator,
      delegate: d.delegate,
      authority: d.authority,
      caveats: d.caveats.map((c) => ({
        enforcer: c.enforcer,
        terms: c.terms,
        args: c.args ?? '0x',
      })),
      salt: d.salt,
      signature: d.signature,
    })),
  }
  const res = await signedFetch(`/session/${sessionId}/redeem-via-account`, sessionId, body)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`a2a redeem-via-account (chain) failed (${res.status}): ${(err as { error?: string }).error ?? res.statusText}`)
  }
  return await res.json() as RedeemTxResult
}

// ─── Sensitive-tier — chained sub-delegated redeem ────────────────────
//
// Formerly routed to `/redeem-subdelegated`. Under Option A, the same
// `/redeem-via-account` endpoint handles every on-chain submit; we route
// to it with `chain` omitted (uses the session's own root delegation).
// Sensitive-tier off-chain `D_sub` minting now happens at the call site
// when a tighter caveat set is required — for now we route via the
// standard redeem path since the underlying TOOL_POLICIES caveats already
// constrain target/selector/value through the session's root delegation.
//
// The caller signature is preserved to keep existing org-mcp tool code
// unchanged.
export interface RedeemSubDelegatedRequest {
  mcpTool: string
  mcpCallId: string
  a2aTaskId: string
  target: Address
  value: bigint
  callData: Hex
}

export async function callA2aRedeemSubDelegated(
  sessionId: string,
  req: RedeemSubDelegatedRequest,
): Promise<RedeemTxResult> {
  const body = {
    mcpTool: req.mcpTool,
    mcpCallId: req.mcpCallId,
    a2aTaskId: req.a2aTaskId,
    target: req.target,
    value: req.value.toString(),
    callData: req.callData,
  }
  const res = await signedFetch(`/session/${sessionId}/redeem-via-account`, sessionId, body)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`a2a redeem-via-account (sensitive) failed (${res.status}): ${(err as { error?: string }).error ?? res.statusText}`)
  }
  return await res.json() as RedeemTxResult
}
