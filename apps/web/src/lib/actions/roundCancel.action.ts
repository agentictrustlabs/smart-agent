'use server'

/**
 * Round cancellation guardian (OZ Governor pattern). Pool root key (or
 * designated lead steward) cancels a Round between AllocationDecided and
 * the first Disbursement — the adversarial-path defense that activates
 * within the 72h dispute window.
 *
 * Phase 0.4 — calls FundRegistry.setRoundStatus(roundSubject, 'canceled')
 * directly. Drops the legacy sa:RoundCanceledAssertion emit; the registry's
 * RoundStatusChanged event + on-chain attribute write are the new public
 * mirror.
 */

import { type Address, type Hex } from 'viem'
import { callMcp } from '@/lib/clients/mcp-client'
import { getWalletClient, getPublicClient } from '@/lib/contracts'
import { FundRegistryClient } from '@smart-agent/sdk'

export type RoundCancelReason =
  | 'dispute'
  | 'security-incident'
  | 'mandate-change'
  | 'steward-action'
  | 'other'

export interface CancelRoundInput {
  roundId: string
  reasonKind: RoundCancelReason
  reasonURI?: string
  /**
   * Optional SESSION_DELEGATION hash to revoke. Wired here for Phase 3 callers;
   * inert in Phase 0.4.
   */
  revokedSessionHash?: string
}

export interface CancelRoundResult {
  roundId: string
  reasonKind: RoundCancelReason
  canceledAt: string
  txHash: Hex
}

export async function cancelRound(input: CancelRoundInput): Promise<CancelRoundResult> {
  const fundRegistryAddr = process.env.FUND_REGISTRY_ADDRESS as Address | undefined
  if (!fundRegistryAddr) throw new Error('FUND_REGISTRY_ADDRESS not set')

  const roundIdSlug = input.roundId.startsWith('urn:smart-agent:round:')
    ? input.roundId.replace('urn:smart-agent:round:', '')
    : input.roundId
  const fullRoundId = `urn:smart-agent:round:${roundIdSlug}`
  const canceledAt = new Date().toISOString()

  const fund = new FundRegistryClient({
    registryAddress: fundRegistryAddr,
    walletClient: getWalletClient(),
    publicClient: getPublicClient(),
  })
  const txHash = await fund.setRoundStatus(roundIdSlug, 'canceled')

  // TODO(phase-3): revoke the SESSION_DELEGATION via DelegationManager when
  // input.revokedSessionHash is provided.

  await callMcp('org', 'round:cancel', {
    roundId: fullRoundId,
    reasonKind: input.reasonKind,
    reasonURI: input.reasonURI,
    revokedSessionHash: input.revokedSessionHash,
  })

  const { scheduleKbSyncEager } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSyncEager()

  return {
    roundId: fullRoundId,
    reasonKind: input.reasonKind,
    canceledAt,
    txHash,
  }
}
