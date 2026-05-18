/**
 * Person-mcp ↔ a2a-agent inter-service client (Phase 4).
 *
 * Mirrors org-mcp's `a2a-client.ts`. Person-mcp does NOT hold a wallet; any
 * on-chain write a person-mcp tool needs is forwarded to a2a-agent's
 * `/session/:id/redeem-tx` endpoint. The session was opened by the user's
 * smart-account session (web action layer); a2a-agent redeems the user's
 * root delegation against the tool's TOOL_POLICIES-gated target.
 *
 * Authentication is the standard inter-service HMAC handshake. After KMS
 * migration K3-extension, signing routes through `buildMcpMacProvider`
 * which uses AWS KMS `kms:GenerateMac` against the `a2a-to-person` HMAC
 * key in production (or the local-hmac dev provider reading
 * `A2A_INTERSERVICE_HMAC_KEY_PERSON` in dev). The canonical message
 * format is UNCHANGED — only the signing primitive swaps.
 */
import { toBase64Url } from '@smart-agent/sdk'
import { buildMcpMacProvider, type KmsMacProvider } from '@smart-agent/sdk/key-custody'
import { createHash, randomUUID } from 'node:crypto'
import type { Address, Hex } from 'viem'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://127.0.0.1:3100'
const SERVICE_NAME = 'person-mcp'

let cachedMacProvider: KmsMacProvider | null = null
function macProvider(): KmsMacProvider {
  if (!cachedMacProvider) {
    cachedMacProvider = buildMcpMacProvider('person', process.env)
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
  const res = await signedFetch(`/session/${sessionId}/redeem-tx`, sessionId, body)
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
