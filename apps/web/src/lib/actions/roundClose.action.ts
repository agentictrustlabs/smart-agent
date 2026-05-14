'use server'

/**
 * Round close + allocation decision orchestration — Tier 1.
 *
 * Flow (post-refactor):
 *
 *   1. Compute the awards Merkle root (web-side; pure function).
 *   2. `round:set_awards_root` MCP tool → FundRegistry.setRoundAwardsRoot.
 *   3. `round:set_status` MCP tool → FundRegistry.setRoundStatus('decided').
 *   4. ProposalRegistry.announceAward(...) per winning proposal — STILL signed
 *      web-side via the deployer EOA. ProposalRegistry writes are not yet
 *      on the org-mcp tool surface; that's a Tier-1.x follow-up.
 *   5. `grant_proposal:award` MCP tool → flip the proposer's MCP row.
 *
 * The web action retains the awards Merkle computation + ProposalRegistry
 * fan-out; the FundRegistry transitions are now MCP-mediated.
 */

import { keccak256, toBytes, toHex, type Address, type Hex } from 'viem'
import { callMcp } from '@/lib/clients/mcp-client'
import { getWalletClient, getPublicClient } from '@/lib/contracts'
import {
  proposalSubject, proposalRegistryAbi, grantProposalRegistryAbi,
  commitmentRegistryAbi,
} from '@smart-agent/sdk'

export interface Award {
  proposalIRI: string
  recipientAgentIRI: string
  recipientAddr: Address
  totalAmount: bigint
  unit: string
  /**
   * Spec 006 — original NeedIntent IRI from the proposal's `basedOnIntent`
   * field. Carried forward into `sa:awardNeedIntent` on the public facet
   * and into `sa:commitmentNeedIntent` on the new commitment row. Empty
   * string when the proposal had no anchoring intent.
   */
  needIntentId?: string
  /**
   * Spec 006 — milestone schedule JSON (proposal body's milestones field).
   * Used to populate `sa:commitmentMilestonesJson`. If absent, the
   * commit defaults to a single-tranche schedule covering the full amount.
   */
  milestonesJson?: string
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
  commitments: Array<{
    proposalIRI: string
    commitmentSubject: Hex
    donor: Address
    recipient: Address
    totalAmount: string  // bigint stringified for JSON serialisation
    txHash: Hex
  }>
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
  const proposalRegistryAddr = process.env.PROPOSAL_REGISTRY_ADDRESS as Address | undefined
  if (!proposalRegistryAddr) throw new Error('PROPOSAL_REGISTRY_ADDRESS not set')

  const decidedAt = input.decidedAt ?? new Date().toISOString()
  const disputeHours = input.disputeHours ?? 72
  const disputeUntil = new Date(Date.parse(decidedAt) + disputeHours * 60 * 60 * 1000).toISOString()
  const roundIdSlug = input.roundId.startsWith('urn:smart-agent:round:')
    ? input.roundId.replace('urn:smart-agent:round:', '')
    : input.roundId
  const fullRoundId = `urn:smart-agent:round:${roundIdSlug}`
  const awardsRoot = computeAwardsRoot(input.awards)
  const disputeUntilSec = Math.floor(Date.parse(disputeUntil) / 1000)

  // 1. AwardsRoot + dispute window via MCP.
  const awardsRootRes = await callMcp<{ ok: true; txHash: Hex }>(
    'org',
    'round:set_awards_root',
    {
      roundId: roundIdSlug,
      awardsRoot,
      disputeUntil: disputeUntilSec,
    },
  )
  const awardsRootTxHash = awardsRootRes.txHash

  // 2. Status → 'decided' via MCP.
  const statusRes = await callMcp<{ ok: true; txHash: Hex; newStatus: string }>(
    'org',
    'round:set_status',
    {
      roundId: roundIdSlug,
      newStatus: 'decided',
    },
  )
  const statusTxHash = statusRes.txHash

  // 4. Per-proposal: announce on chain (public facet) + flip MCP row +
  //    spec-006 — create the commitment row in CommitmentRegistry.
  // All three writes are still signed via the deployer EOA on the web side
  // (Tier-1.x follow-up to move ProposalRegistry + CommitmentRegistry onto
  // the org-mcp tool surface).
  const proposalAnnouncements: Array<{ proposalIRI: string; txHash: Hex }> = []
  const commitments: CloseRoundResult['commitments'] = []
  const wallet = getWalletClient()
  const account = wallet.account!
  const publicClient = getPublicClient()

  const commitmentRegistryAddr = process.env.COMMITMENT_REGISTRY_ADDRESS as Address | undefined
  const usdcAddr = (process.env.USDC_ADDRESS ?? process.env.MOCK_USDC_ADDRESS) as Address | undefined

  for (const a of input.awards) {
    const proposalSlug = a.proposalIRI.replace(/^urn:smart-agent:proposal:/, '')
    const ps = proposalSubject(proposalSlug)
    const roundSubject = keccak256(new TextEncoder().encode(`sa:round:${roundIdSlug}`))
    const needIntentString = a.needIntentId ?? ''
    const txHash = await wallet.writeContract({
      address: proposalRegistryAddr,
      abi: proposalRegistryAbi,
      functionName: 'announceAward',
      args: [{
        proposalSubject: ps,
        kind: keccak256(new TextEncoder().encode(KIND_DEFAULT)),
        basedOnIntentId: needIntentString
          ? keccak256(new TextEncoder().encode(needIntentString))
          : (('0x' + '0'.repeat(64)) as Hex),
        round: roundSubject,
        proposer: ('0x' + '0'.repeat(40)) as Address,
        recipient: a.recipientAddr,
        totalAwarded: a.totalAmount,
        bodyHash: keccak256(toBytes(a.proposalIRI)),
        awardingFund: input.poolAgentId,
        status: keccak256(new TextEncoder().encode('sa:ProposalAwarded')),
        needIntentIdString: needIntentString,
      }],
      account,
      chain: wallet.chain ?? null,
    })
    await publicClient.waitForTransactionReceipt({ hash: txHash })
    proposalAnnouncements.push({ proposalIRI: a.proposalIRI, txHash })

    // R8 — propagate awarded status to the spec-004 GrantProposalRegistry
    // so my on-chain reader (org-mcp/lib/grant-proposal-reader.ts)
    // surfaces the proposal as "awarded" on detail pages + listings.
    // Auth: GrantProposalRegistry.setStatus requires msg.sender to be an
    // owner of the round's fund agent. The deployer is an initial owner
    // of every freshly-deployed AgentAccount in the test environment, so
    // this direct call from the deployer wallet passes the modifier.
    const gpRegistryAddr = process.env.GRANT_PROPOSAL_REGISTRY_ADDRESS as Address | undefined
    if (gpRegistryAddr) {
      // a.proposalIRI is either a URN ("urn:smart-agent:proposal:<slug>")
      // or a bytes32 hex (the on-chain subject). Spec-004 reader returns
      // proposals keyed by bytes32 subject, so the path that lands here
      // typically already has hex.
      const isHex = /^0x[0-9a-fA-F]{64}$/.test(a.proposalIRI)
      const gp = isHex ? (a.proposalIRI as Hex) : ps
      try {
        const statusTx = await wallet.writeContract({
          address: gpRegistryAddr,
          abi: grantProposalRegistryAbi,
          functionName: 'setStatus',
          args: [gp, keccak256(toHex('sa:GpAwarded'))],
          account,
          chain: wallet.chain ?? null,
        })
        await publicClient.waitForTransactionReceipt({ hash: statusTx })
      } catch (err) {
        console.warn('[closeRound] GrantProposalRegistry.setStatus failed (non-fatal):', err instanceof Error ? err.message : err)
      }
    }

    // Spec-006: create the commitment row that owns the disbursement +
    // fulfillment lifecycle. donor = pool, recipient = resolved treasury,
    // sourceKind = MATCH_AWARD, sourceSubject = the proposal subject.
    // The deployer is an owner of pool (initial-owner pattern), so direct
    // EOA call passes the donor-owner gate. Non-fatal: if the registry
    // isn't deployed or the call reverts, closeRound still succeeds — the
    // commitment can be created in a follow-up reconciliation pass.
    if (commitmentRegistryAddr && usdcAddr) {
      try {
        const sourceKind = keccak256(toBytes('sa:CommitmentSourceAward'))
        const milestones = a.milestonesJson && a.milestonesJson.trim().length > 0
          ? a.milestonesJson
          : '[{"id":"single","label":"On award","trancheBps":10000}]'
        const commitTx = await wallet.writeContract({
          address: commitmentRegistryAddr,
          abi: commitmentRegistryAbi,
          functionName: 'commit',
          args: [{
            sourceKind,
            sourceSubject: ps,
            round: roundSubject,
            donor: input.poolAgentId,
            recipient: a.recipientAddr,
            token: usdcAddr,
            totalAmount: a.totalAmount,
            needIntentId: needIntentString || `urn:smart-agent:proposal:${proposalSlug}`,
            offerIntentId: '',
            milestonesJson: milestones,
          }],
          account,
          chain: wallet.chain ?? null,
        })
        await publicClient.waitForTransactionReceipt({ hash: commitTx })
        const commitmentSubject = keccak256(
          new Uint8Array([
            ...toBytes('sa:commitment:'),
            ...toBytes(sourceKind),
            ...toBytes(ps),
            ...toBytes(input.poolAgentId.toLowerCase() as `0x${string}`),
          ]),
        )
        commitments.push({
          proposalIRI: a.proposalIRI,
          commitmentSubject,
          donor: input.poolAgentId,
          recipient: a.recipientAddr,
          totalAmount: a.totalAmount.toString(),
          txHash: commitTx,
        })
      } catch (err) {
        console.warn('[closeRound] CommitmentRegistry.commit failed (non-fatal):', err instanceof Error ? err.message : err)
      }
    }

    // Flip the proposer's MCP row to 'awarded' (legacy path; the spec-004
    // reader already picks up the on-chain status above).
    try {
      await callMcp('org', 'grant_proposal:award', {
        proposalId: a.proposalIRI,
        totalAwarded: Number(a.totalAmount),
        unit: a.unit,
        awardedAt: decidedAt,
      })
    } catch { /* stub tool — non-fatal */ }
  }

  const { scheduleKbSyncEager } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSyncEager()
  // Spec 006 — mirror the new commitment rows to GraphDB so the proposer /
  // intent surfaces can render them immediately. Best-effort; the periodic
  // kb-sync catches any miss.
  if (commitments.length > 0) {
    try {
      const { syncAllCommitmentsToGraphDB } = await import('@/lib/ontology/graphdb-sync')
      const r = await syncAllCommitmentsToGraphDB()
      if (!r.ok) console.warn('[closeRound] commitment sync warning:', r.message)
    } catch (err) {
      console.warn('[closeRound] commitment sync threw:', err instanceof Error ? err.message : err)
    }
  }

  return {
    roundId: fullRoundId,
    decidedAt,
    disputeUntil,
    awardsRoot,
    awardsRootTxHash,
    statusTxHash,
    proposalAnnouncements,
    commitments,
  }
}
