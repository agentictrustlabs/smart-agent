/**
 * Person-mcp ↔ a2a-agent inter-service client (Phase 4).
 *
 * Mirrors org-mcp's `a2a-client.ts`. Person-mcp does NOT hold a wallet; any
 * on-chain write a person-mcp tool needs is forwarded to a2a-agent's
 * `/session/:id/redeem-tx` endpoint. The session was opened by the user's
 * smart-account session (web action layer); a2a-agent redeems the user's
 * root delegation against the tool's TOOL_POLICIES-gated target.
 *
 * Authentication is the standard inter-service HMAC handshake — same wire
 * format as org-mcp; only the env var key differs
 * (A2A_INTERSERVICE_HMAC_KEY_PERSON).
 */
import { hmacSign } from '@smart-agent/sdk'
import type { Address, Hex } from 'viem'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://127.0.0.1:3100'
const SERVICE_NAME = 'person-mcp'

function getHmacSecret(): string {
  const s = process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON
  if (!s) throw new Error('person-mcp: A2A_INTERSERVICE_HMAC_KEY_PERSON not set')
  return s
}

async function signedFetch(
  path: string,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const bodyJson = JSON.stringify(body)
  const timestamp = Math.floor(Date.now() / 1000)
  const canonical = `${bodyJson}:${timestamp}:${sessionId}`
  const signature = await hmacSign(canonical, getHmacSecret())
  return fetch(`${A2A_AGENT_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': SERVICE_NAME,
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature,
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
