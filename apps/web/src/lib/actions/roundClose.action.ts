'use server'

/**
 * Round close + allocation decision orchestration.
 *
 * Phase 4 — Web→MCP rewiring.
 *
 *   1. Compute the awards Merkle root (web-side; pure function).
 *   2. `round:set_awards_root` MCP tool → FundRegistry.setRoundAwardsRoot.
 *   3. `round:set_status` MCP tool → FundRegistry.setRoundStatus('decided').
 *   4. Per award: `proposal_registry:announce_award` MCP tool +
 *      `grant_proposal:award` MCP tool + `commitment:commit` MCP tool.
 *
 * Every on-chain write here is now MCP-mediated; the web layer holds
 * no signing capability.
 */

import { keccak256, toBytes, type Address, type Hex } from 'viem'
import { callMcp } from '@/lib/clients/mcp-client'
import { proposalSubject } from '@smart-agent/sdk'

export interface Award {
  proposalIRI: string
  recipientAgentIRI: string
  recipientAddr: Address
  totalAmount: bigint
  unit: string
  /** Spec 006 — original NeedIntent IRI from the proposal's `basedOnIntent`
   *  field. Carried forward into `sa:awardNeedIntent` on the public facet
   *  and into `sa:commitmentNeedIntent` on the new commitment row. */
  needIntentId?: string
  /** Spec 006 — milestone schedule JSON. */
  milestonesJson?: string
}

export interface CloseRoundInput {
  /** Round id (URN or slug). */
  roundId: string
  /** Pool / fund agent address — caller must be one of its owners. */
  poolAgentId: Address
  /** Award list — one entry per winning proposal. */
  awards: Award[]
  /** ISO-8601 decision timestamp. Defaults to now. */
  decidedAt?: string
  /** Dispute-window length in hours. Defaults to 72. */
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
    totalAmount: string
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

export async function closeRound(input: CloseRoundInput): Promise<CloseRoundResult> {
  const decidedAt = input.decidedAt ?? new Date().toISOString()
  const disputeHours = input.disputeHours ?? 72
  const disputeUntil = new Date(Date.parse(decidedAt) + disputeHours * 60 * 60 * 1000).toISOString()
  const roundIdSlug = input.roundId.startsWith('urn:smart-agent:round:')
    ? input.roundId.replace('urn:smart-agent:round:', '')
    : input.roundId
  const fullRoundId = `urn:smart-agent:round:${roundIdSlug}`
  const awardsRoot = computeAwardsRoot(input.awards)
  const disputeUntilSec = Math.floor(Date.parse(disputeUntil) / 1000)
  const roundSubject = keccak256(new TextEncoder().encode(`sa:round:${roundIdSlug}`))

  // 1. AwardsRoot + dispute window via MCP.
  const awardsRootRes = await callMcp<{ ok: true; txHash: Hex }>(
    'org',
    'round:set_awards_root',
    {
      roundId: roundIdSlug,
      awardsRoot,
      disputeUntil: disputeUntilSec,
    },
    { agentAddress: input.poolAgentId },
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
    { agentAddress: input.poolAgentId },
  )
  const statusTxHash = statusRes.txHash

  // 3. Per-proposal — announce public facet + flip private row + open commitment.
  const proposalAnnouncements: Array<{ proposalIRI: string; txHash: Hex }> = []
  const commitments: CloseRoundResult['commitments'] = []

  const usdcAddr = (process.env.USDC_ADDRESS ?? process.env.MOCK_USDC_ADDRESS) as Address | undefined

  for (const a of input.awards) {
    const proposalSlug = a.proposalIRI.replace(/^urn:smart-agent:proposal:/, '')
    const ps = /^0x[0-9a-fA-F]{64}$/.test(a.proposalIRI)
      ? (a.proposalIRI as Hex)
      : proposalSubject(proposalSlug)
    const needIntentString = a.needIntentId ?? ''

    try {
      const annRes = await callMcp<{ ok: true; txHash: Hex }>(
        'org',
        'proposal_registry:announce_award',
        {
          proposalSubject: ps,
          kind: 'sa:GivingKind',
          basedOnIntentId: needIntentString
            ? keccak256(new TextEncoder().encode(needIntentString))
            : ('0x' + '0'.repeat(64)),
          roundSubject,
          proposer: ('0x' + '0'.repeat(40)),
          recipient: a.recipientAddr,
          totalAwarded: a.totalAmount.toString(),
          bodyHash: keccak256(toBytes(a.proposalIRI)),
          awardingFund: input.poolAgentId,
          status: 'sa:ProposalAwarded',
          needIntentIdString: needIntentString,
        },
        { agentAddress: input.poolAgentId },
      )
      proposalAnnouncements.push({ proposalIRI: a.proposalIRI, txHash: annRes.txHash })
    } catch (err) {
      console.warn('[closeRound] announceAward failed (non-fatal):', err instanceof Error ? err.message : err)
    }

    // Flip the spec-004 GrantProposalRegistry status flag via MCP.
    try {
      await callMcp('org', 'grant_proposal:award', {
        proposalId: a.proposalIRI,
        totalAwarded: Number(a.totalAmount),
        unit: a.unit,
        awardedAt: decidedAt,
      }, { agentAddress: input.poolAgentId })
    } catch { /* award tool is a stub in v2; non-fatal */ }

    // Open the spec-006 commitment row.
    if (usdcAddr) {
      try {
        const milestones = a.milestonesJson && a.milestonesJson.trim().length > 0
          ? a.milestonesJson
          : '[{"id":"single","label":"On award","trancheBps":10000}]'
        const commitRes = await callMcp<{ ok: true; txHash: Hex; commitmentSubject: Hex }>(
          'org',
          'commitment:commit',
          {
            sourceKind: 'sa:CommitmentSourceAward',
            sourceSubject: ps,
            round: roundSubject,
            donor: input.poolAgentId,
            recipient: a.recipientAddr,
            token_: usdcAddr,
            totalAmount: a.totalAmount.toString(),
            needIntentId: needIntentString || `urn:smart-agent:proposal:${proposalSlug}`,
            offerIntentId: '',
            milestonesJson: milestones,
          },
          { agentAddress: input.poolAgentId },
        )
        commitments.push({
          proposalIRI: a.proposalIRI,
          commitmentSubject: commitRes.commitmentSubject,
          donor: input.poolAgentId,
          recipient: a.recipientAddr,
          totalAmount: a.totalAmount.toString(),
          txHash: commitRes.txHash,
        })
      } catch (err) {
        console.warn('[closeRound] commitment:commit failed (non-fatal):', err instanceof Error ? err.message : err)
      }
    }
  }

  const { scheduleKbSyncEager } = await import('@/lib/ontology/kb-write-through')
  scheduleKbSyncEager()
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
