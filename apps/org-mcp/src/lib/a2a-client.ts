/**
 * Org-mcp ↔ a2a-agent inter-service client.
 *
 * Signs requests with the shared HMAC secret (A2A_INTERSERVICE_HMAC_KEY_ORG)
 * so a2a-agent's privileged session endpoints can verify the caller is an
 * enrolled MCP server.
 *
 * Used by every org-mcp tool that needs to:
 *   - deploy a smart account (pool agent creation)
 *   - redeem a user delegation on-chain (pool/round mutations)
 *   - mint + redeem a per-call sub-delegation (sensitive ops in Phase 2)
 *
 * The user-delegation bearer token is a SEPARATE auth plane and is handled
 * by mcp-proxy when MCP calls arrive. Inter-service auth proves the MCP
 * server's identity to a2a-agent; user-delegation auth proves the user's
 * authorization to the MCP server.
 */
import { hmacSign } from '@smart-agent/sdk'
import type { Address, Hex } from 'viem'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://127.0.0.1:3100'
const SERVICE_NAME = 'org-mcp'

function getHmacSecret(): string {
  const s = process.env.A2A_INTERSERVICE_HMAC_KEY_ORG
  if (!s) throw new Error('org-mcp: A2A_INTERSERVICE_HMAC_KEY_ORG not set')
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
  const res = await signedFetch(`/session/${sessionId}/redeem-subdelegated`, sessionId, body)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`a2a redeem-subdelegated failed (${res.status}): ${(err as { error?: string }).error ?? res.statusText}`)
  }
  return await res.json() as RedeemTxResult
}
