'use server'

/**
 * Pool admin server actions — Tier 1 thin proxies.
 *
 * The on-chain writes (PoolRegistry.updateMandate / rotateStewards) now live
 * in org-mcp's `pool:update_mandate` / `pool:rotate_stewards` tools. The MCP
 * tool verifies the delegation token, asserts the caller is the pool's first
 * steward, then signs the tx with its deployer EOA (Tier 1) — replacing the
 * web's old `canManageAgent` pre-flight + direct deployer-key signing.
 *
 * Behavioral note: the old action computed `mandateHash =
 * keccak256(JSON.stringify(input.mandate))` web-side. We keep that hashing
 * step here so the on-the-wire payload to the MCP is the already-canonical
 * hex digest — the MCP doesn't need (and shouldn't trust) the raw mandate
 * body.
 */

import { keccak256, toHex, type Address, type Hex } from 'viem'
import { callMcp, McpCallError } from '@/lib/clients/mcp-client'

export interface ActionFailure { ok: false; error: string }

export interface UpdateMandateInput {
  poolAgent: Address
  poolIRI: string                  // for cache update (urn:smart-agent:pool:<slug>)
  mandate: Record<string, unknown> // canonical mandate JSON; hashed for chain
  mandateURI?: string              // optional ipfs/https URI
}

export async function updatePoolMandate(
  input: UpdateMandateInput,
): Promise<{ ok: true; txHash: Hex } | ActionFailure> {
  const mandateJson = JSON.stringify(input.mandate)
  const mandateHash = keccak256(toHex(mandateJson))

  try {
    const res = await callMcp<{ ok: true; txHash: Hex }>('org', 'pool:update_mandate', {
      poolAgent: input.poolAgent,
      newMandateHash: mandateHash,
      newMandateURI: input.mandateURI ?? '',
    })
    const { hubScheduleKbSync } = await import('@/lib/clients/hub-client')
    await hubScheduleKbSync(true)
    return res
  } catch (err) {
    if (err instanceof McpCallError) return { ok: false, error: err.message }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface RotateStewardsInput {
  poolAgent: Address
  poolIRI: string
  stewards: Address[]
}

export async function rotatePoolStewards(
  input: RotateStewardsInput,
): Promise<{ ok: true; txHash: Hex } | ActionFailure> {
  try {
    const res = await callMcp<{ ok: true; txHash: Hex }>('org', 'pool:rotate_stewards', {
      poolAgent: input.poolAgent,
      newStewards: input.stewards,
    })
    const { hubScheduleKbSync } = await import('@/lib/clients/hub-client')
    await hubScheduleKbSync(true)
    return res
  } catch (err) {
    if (err instanceof McpCallError) return { ok: false, error: err.message }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
