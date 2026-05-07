'use server'

/**
 * Round close + allocation decision orchestration (Phase 0.4 + 0.5).
 *
 * Stewards have signed the AllocationDecided EIP-712 payload off-chain
 * (sigs collected via `treasury_proposal:*` tools). This action lands the
 * decision on chain:
 *
 *   1. FundRegistry.setRoundAwardsRoot(roundSubject, root, disputeUntil)
 *   2. FundRegistry.setRoundStatus(roundSubject, 'decided')
 *   3. ProposalRegistry.announceAward(...) per winning proposal — public
 *      facets only; body stays in person-mcp per
 *      sa:GrantProposalAlwaysPrivateShape.
 *   4. (Phase 3) DelegationManager mint of SESSION_DELEGATION whose
 *      RoundDecisionWindowEnforcer terms carry awardsRoot + disputeUntil.
 *
 * org-mcp side: round status flips to 'decided' via the cache update tool.
 * grant_proposal:award still runs to mark the proposer's MCP row.
 *
 * Drops the legacy sa:RoundClosedAssertion / sa:AllocationDecidedAssertion /
 * sa:DisputeWindowOpenedAssertion / sa:GrantAwardedAssertion emits — the
 * registry's events + on-chain attribute writes are the new public mirror.
 */

import { keccak256, toBytes, type Address, type Hex } from 'viem'
import { callMcp } from '@/lib/clients/mcp-client'
import { getWalletClient, getPublicClient } from '@/lib/contracts'
import { FundRegistryClient, proposalSubject } from '@smart-agent/sdk'
import { proposalRegistryAbi } from '@smart-agent/sdk'

export interface Award {
  proposalIRI: string
  recipientAgentIRI: string
  recipientAddr: Address
  totalAmount: bigint
  unit: string
}

export interface CloseRoundInput {
  /** Round id (URN or slug). Resolved to URN form internally. */
  roundId: string
  /** Pool / fund agent address — caller must be one of its owners. */
  poolAgentId: Address
  /** Award list — one entry per winning proposal. */
  awards: Award[]
  /** ISO-8601 decision timestamp. Defaults to now. */
  decidedAt?: string
  /** Dispute-window length in hours. Defaults to 72 per oSnap pattern. */
  disputeHours?: number
  /** Hash of (signerSet, threshold) at decision time. */
  stewardSetHash?: string
}

export interface CloseRoundResult {
  roundId: string
  decidedAt: string
  disputeUntil: string
  awardsRoot: Hex
  awardsRootTxHash: Hex
  statusTxHash: Hex
  proposalAnnouncements: Array<{ proposalIRI: string; txHash: Hex }>
}

/** Compute the Merkle awardsRoot the SESSION_DELEGATION will commit to. */
function computeAwardsRoot(awards: Award[]): Hex {
  const leaves = awards.map(a => {
    const proposalIRIHash = keccak256(toBytes(a.proposalIRI))
    return keccak256(
      new Uint8Array([
        ...toBytes(proposalIRIHash),
        ...toBytes(a.recipientAddr.toLowerCase() as `0x${string}`),
        ...toBytes(`0x${a.totalAmount.toString(16).padStart(64, '0')}`),
      ]),
    )
  })

  if (leaves.length === 0) return ('0x' + '0'.repeat(64)) as Hex
  let layer: `0x${string}`[] = leaves as `0x${string}`[]
  while (layer.length > 1) {
    const next: `0x${string}`[] = []
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i]!
      const b = i + 1 < layer.length ? layer[i + 1]! : a
      const [lo, hi] = a < b ? [a, b] : [b, a]
      next.push(keccak256(new Uint8Array([...toBytes(lo), ...toBytes(hi)])))
    }
    layer = next
  }
  return layer[0]!
}

const KIND_DEFAULT = 'sa:GivingKind'

export async function closeRound(input: CloseRoundInput): Promise<CloseRoundResult> {
  const fundRegistryAddr = process.env.FUND_REGISTRY_ADDRESS as Address | undefined
  const proposalRegistryAddr = process.env.PROPOSAL_REGISTRY_ADDRESS as Address | undefined
  if (!fundRegistryAddr) throw new Error('FUND_REGISTRY_ADDRESS not set')
  if (!proposalRegistryAddr) throw new Error('PROPOSAL_REGISTRY_ADDRESS not set')

  const decidedAt = input.decidedAt ?? new Date().toISOString()
  const disputeHours = input.disputeHours ?? 72
  const disputeUntil = new Date(Date.parse(decidedAt) + disputeHours * 60 * 60 * 1000).toISOString()
  const roundIdSlug = input.roundId.startsWith('urn:smart-agent:round:')
    ? input.roundId.replace('urn:smart-agent:round:', '')
    : input.roundId
  const fullRoundId = `urn:smart-agent:round:${roundIdSlug}`
  const awardsRoot = computeAwardsRoot(input.awards)
  const disputeUntilSec = BigInt(Math.floor(Date.parse(disputeUntil) / 1000))

  const fund = new FundRegistryClient({
    registryAddress: fundRegistryAddr,
    walletClient: getWalletClient(),
    publicClient: getPublicClient(),
  })

  // 1. AwardsRoot + dispute window (single tx).
  const awardsRootTxHash = await fund.setRoundAwardsRoot(roundIdSlug, awardsRoot, disputeUntilSec)
  // 2. Status → 'decided'
  const statusTxHash = await fund.setRoundStatus(roundIdSlug, 'decided')

  // 3. Persist closure cache + per-proposal awarded flag (org-mcp).
  await callMcp('org', 'round:close', {
    roundId: fullRoundId,
    awardsRoot,
    decidedAt,
    disputeUntil,
    stewardSetHash: input.stewardSetHash,
  })

  // 4. Per-proposal: announce on chain (public facet) + flip MCP row.
  const proposalAnnouncements: Array<{ proposalIRI: string; txHash: Hex }> = []
  const wallet = getWalletClient()
  const account = wallet.account!
  const publicClient = getPublicClient()

  for (const a of input.awards) {
    const proposalSlug = a.proposalIRI.replace(/^urn:smart-agent:proposal:/, '')
    const ps = proposalSubject(proposalSlug)
    const txHash = await wallet.writeContract({
      address: proposalRegistryAddr,
      abi: proposalRegistryAbi,
      functionName: 'announceAward',
      args: [{
        proposalSubject: ps,
        kind: keccak256(new TextEncoder().encode(KIND_DEFAULT)),
        basedOnIntentId: ('0x' + '0'.repeat(64)) as Hex,
        round: keccak256(new TextEncoder().encode(`sa:round:${roundIdSlug}`)),
        proposer: ('0x' + '0'.repeat(40)) as Address,
        recipient: a.recipientAddr,
        totalAwarded: a.totalAmount,
        bodyHash: keccak256(toBytes(a.proposalIRI)),
        awardingFund: input.poolAgentId,
        status: keccak256(new TextEncoder().encode('sa:ProposalAwarded')),
      }],
      account,
      chain: wallet.chain ?? null,
    })
    await publicClient.waitForTransactionReceipt({ hash: txHash })
    proposalAnnouncements.push({ proposalIRI: a.proposalIRI, txHash })

    // Flip the proposer's MCP row to 'awarded'.
    await callMcp('org', 'grant_proposal:award', {
      proposalId: a.proposalIRI,
      totalAwarded: Number(a.totalAmount),
      unit: a.unit,
      awardedAt: decidedAt,
    })
  }

  const { scheduleKbSync } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSync()

  return {
    roundId: fullRoundId,
    decidedAt,
    disputeUntil,
    awardsRoot,
    awardsRootTxHash,
    statusTxHash,
    proposalAnnouncements,
  }
}
