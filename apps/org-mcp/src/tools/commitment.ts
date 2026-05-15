/**
 * Phase 4 — CommitmentRegistry MCP tools.
 *
 * Spec-006 commitments (grant-lane + direct-lane + pool-pledge-lane disbursement
 * tracking) used to be written directly by the web action layer using the
 * deployer wallet. Phase 4 routes those writes through a2a-agent's
 * stateless-redeem path so the web app no longer signs them.
 *
 * Tools registered:
 *   - commitment:commit          — CommitmentRegistry.commit (round-close
 *                                  + match-accept paths)
 *   - commitment:record_release  — CommitmentRegistry.recordRelease (when
 *                                  release tx is split from Rail-A batch
 *                                  on the donor-EOA side; v1 most release
 *                                  flows still bundle via executeBatch)
 *   - commitment:cancel          — CommitmentRegistry.cancelCommitment
 *   - commitment:list            — chain read: scan allSubjects() and
 *                                  filter by donor / recipient
 *   - commitment:get             — chain read: single commitment row
 */
import { encodeFunctionData, keccak256, toBytes, toHex, type Address, type Hex } from 'viem'
import { randomUUID } from 'node:crypto'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'
import { commitmentRegistryAbi } from '@smart-agent/sdk'
import { callA2aRedeem } from '../lib/a2a-client.js'
import {
  requireCommitmentRegistryAddress,
  getPublicClient,
} from '../lib/contracts.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

function requireSessionId(args: { _a2aSessionId?: string }): string {
  const id = args._a2aSessionId
  if (!id || typeof id !== 'string') {
    throw new Error('missing _a2aSessionId — Phase 1 requires routing through a2a-agent mcp-proxy')
  }
  return id
}

const ZERO_BYTES32 = ('0x' + '0'.repeat(64)) as Hex

// ─── Tool: commitment:commit ───────────────────────────────────────────

interface CommitArgs {
  token: string
  /** CURIE — 'sa:CommitmentSourceAward' | 'sa:CommitmentSourceDirectMatch' | 'sa:CommitmentSourcePoolPledge'. */
  sourceKind: string
  sourceSubject: Hex
  round?: Hex
  donor: Address
  recipient: Address
  token_: Address           // ERC-20 token (USDC in v1) — name clashes with the field 'token'
  totalAmount: string       // decimal bigint
  needIntentId?: string
  offerIntentId?: string
  /** JSON array; defaults to single-tranche on-award schedule. */
  milestonesJson?: string
  _a2aSessionId?: string
}

const commitTool = {
  name: 'commitment:commit',
  description:
    "Open a Commitment row on CommitmentRegistry. donor must be an AgentAccount the caller can manage (e.g. a pool for grant-lane awards). Routes via a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token:          { type: 'string' },
      sourceKind:     { type: 'string' },
      sourceSubject:  { type: 'string' },
      round:          { type: 'string' },
      donor:          { type: 'string' },
      recipient:      { type: 'string' },
      token_:         { type: 'string' },
      totalAmount:    { type: 'string' },
      needIntentId:   { type: 'string' },
      offerIntentId:  { type: 'string' },
      milestonesJson: { type: 'string' },
    },
    required: ['token', 'sourceKind', 'sourceSubject', 'donor', 'recipient', 'token_', 'totalAmount'],
  },
  handler: async (args: CommitArgs) => {
    await requireOrgPrincipal(args.token, args, 'commitment:commit')
    const sessionId = requireSessionId(args)
    const target = requireCommitmentRegistryAddress()
    const sourceKindHash = keccak256(toBytes(args.sourceKind))
    const milestones = (args.milestonesJson && args.milestonesJson.trim().length > 0)
      ? args.milestonesJson
      : '[{"id":"single","label":"On award","trancheBps":10000}]'
    const data = encodeFunctionData({
      abi: commitmentRegistryAbi,
      functionName: 'commit',
      args: [{
        sourceKind:     sourceKindHash,
        sourceSubject:  args.sourceSubject,
        round:          args.round ?? ZERO_BYTES32,
        donor:          args.donor,
        recipient:      args.recipient,
        token:          args.token_,
        totalAmount:    BigInt(args.totalAmount),
        needIntentId:   args.needIntentId ?? '',
        offerIntentId:  args.offerIntentId ?? '',
        milestonesJson: milestones,
      }],
    })
    const r = await callA2aRedeem(sessionId, {
      mcpTool: 'commitment:commit',
      mcpCallId: randomUUID(),
      target,
      value: 0n,
      callData: data,
    })

    // Compute the commitmentSubject for the response (same formula as the
    // registry's commitmentSubject(...) pure function).
    const commitmentSubject = keccak256(
      new Uint8Array([
        ...toBytes('sa:commitment:'),
        ...toBytes(sourceKindHash),
        ...toBytes(args.sourceSubject),
        ...toBytes(args.donor.toLowerCase() as `0x${string}`),
      ]),
    )
    return mcpText({
      ok: true as const,
      txHash: r.txHash,
      commitmentSubject,
    })
  },
}

// ─── Tool: commitment:record_release ───────────────────────────────────

interface RecordReleaseArgs {
  token: string
  commitmentSubject: Hex
  /** Slug (will be keccak256'd) OR a precomputed bytes32 hex. */
  milestoneId: string
  amount: string
  _a2aSessionId?: string
}

const recordReleaseTool = {
  name: 'commitment:record_release',
  description:
    "Record a per-milestone release on CommitmentRegistry. Used when the release tx is split out from the Rail-A executeBatch. Routes via a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token:             { type: 'string' },
      commitmentSubject: { type: 'string' },
      milestoneId:       { type: 'string' },
      amount:            { type: 'string' },
    },
    required: ['token', 'commitmentSubject', 'milestoneId', 'amount'],
  },
  handler: async (args: RecordReleaseArgs) => {
    await requireOrgPrincipal(args.token, args, 'commitment:record_release')
    const sessionId = requireSessionId(args)
    const target = requireCommitmentRegistryAddress()
    const milestoneIdHash = /^0x[0-9a-fA-F]{64}$/.test(args.milestoneId)
      ? (args.milestoneId as Hex)
      : keccak256(toBytes(args.milestoneId))
    const data = encodeFunctionData({
      abi: commitmentRegistryAbi,
      functionName: 'recordRelease',
      args: [args.commitmentSubject, milestoneIdHash, BigInt(args.amount)],
    })
    const r = await callA2aRedeem(sessionId, {
      mcpTool: 'commitment:record_release',
      mcpCallId: randomUUID(),
      target,
      value: 0n,
      callData: data,
    })
    return mcpText({ ok: true as const, txHash: r.txHash })
  },
}

// ─── Tool: commitment:record_outcome ───────────────────────────────────

interface RecordOutcomeArgs {
  token: string
  commitmentSubject: Hex
  /** Slug (will be keccak256'd) OR a precomputed bytes32 hex. */
  outcomeId: string
  /** sha256 of the evidence document (bytes32 hex). MUST be non-zero. */
  evidenceHash: Hex
  _a2aSessionId?: string
}

const recordOutcomeTool = {
  name: 'commitment:record_outcome',
  description:
    "Record a validator outcome attestation on CommitmentRegistry. Permissionless on chain — validator eligibility is gated off-chain by org-mcp via the round's validator list (AnonCreds-style v1 fallback). Routes via a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token:             { type: 'string' },
      commitmentSubject: { type: 'string' },
      outcomeId:         { type: 'string' },
      evidenceHash:      { type: 'string' },
    },
    required: ['token', 'commitmentSubject', 'outcomeId', 'evidenceHash'],
  },
  handler: async (args: RecordOutcomeArgs) => {
    await requireOrgPrincipal(args.token, args, 'commitment:record_outcome')
    const sessionId = requireSessionId(args)
    const target = requireCommitmentRegistryAddress()
    if (!args.evidenceHash || args.evidenceHash === ZERO_BYTES32) {
      throw new Error('evidenceHash is required (non-zero bytes32)')
    }
    const outcomeIdHash = /^0x[0-9a-fA-F]{64}$/.test(args.outcomeId)
      ? (args.outcomeId as Hex)
      : keccak256(toBytes(args.outcomeId))
    const data = encodeFunctionData({
      abi: commitmentRegistryAbi,
      functionName: 'recordOutcome',
      args: [args.commitmentSubject, outcomeIdHash, args.evidenceHash],
    })
    const r = await callA2aRedeem(sessionId, {
      mcpTool: 'commitment:record_outcome',
      mcpCallId: randomUUID(),
      target,
      value: 0n,
      callData: data,
    })
    return mcpText({ ok: true as const, txHash: r.txHash })
  },
}

// ─── Tool: commitment:cancel ───────────────────────────────────────────

interface CancelArgs {
  token: string
  commitmentSubject: Hex
  reason: string
  _a2aSessionId?: string
}

const cancelTool = {
  name: 'commitment:cancel',
  description:
    "Cancel a Commitment (status → canceled). Caller must be an owner of the donor AgentAccount. Routes via a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token:             { type: 'string' },
      commitmentSubject: { type: 'string' },
      reason:            { type: 'string' },
    },
    required: ['token', 'commitmentSubject', 'reason'],
  },
  handler: async (args: CancelArgs) => {
    await requireOrgPrincipal(args.token, args, 'commitment:cancel')
    const sessionId = requireSessionId(args)
    const target = requireCommitmentRegistryAddress()
    const reasonHash = keccak256(toBytes(args.reason))
    const data = encodeFunctionData({
      abi: commitmentRegistryAbi,
      functionName: 'cancelCommitment',
      args: [args.commitmentSubject, reasonHash],
    })
    const r = await callA2aRedeem(sessionId, {
      mcpTool: 'commitment:cancel',
      mcpCallId: randomUUID(),
      target,
      value: 0n,
      callData: data,
    })
    return mcpText({ ok: true as const, txHash: r.txHash })
  },
}

// ─── Tool: commitment:get ──────────────────────────────────────────────

interface GetArgs {
  token: string
  commitmentSubject: Hex
}

const STATUS_LABEL: Record<string, string> = {
  [keccak256(toHex('sa:CommitmentPending')).toLowerCase()]:         'pending',
  [keccak256(toHex('sa:CommitmentInFlight')).toLowerCase()]:        'in-flight',
  [keccak256(toHex('sa:CommitmentCompleted')).toLowerCase()]:       'completed',
  [keccak256(toHex('sa:CommitmentCanceled')).toLowerCase()]:        'canceled',
  [keccak256(toHex('sa:CommitmentReleasesBlocked')).toLowerCase()]: 'releases-blocked',
}

const getTool = {
  name: 'commitment:get',
  description: "Read a single Commitment row from CommitmentRegistry.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token:             { type: 'string' },
      commitmentSubject: { type: 'string' },
    },
    required: ['token', 'commitmentSubject'],
  },
  handler: async (args: GetArgs) => {
    await requireOrgPrincipal(args.token, args, 'commitment:get')
    const target = requireCommitmentRegistryAddress()
    const pub = getPublicClient()
    try {
      const tuple = await pub.readContract({
        address: target,
        abi: commitmentRegistryAbi,
        functionName: 'getCommitment',
        args: [args.commitmentSubject],
      }) as readonly [Hex, Hex, Address, Address, Address, bigint, bigint, Hex]
      const [sourceKind, sourceSubject, donor, recipient, tok, totalAmount, releasedAmount, status] = tuple
      if (donor === '0x0000000000000000000000000000000000000000') {
        return mcpText({ commitment: null })
      }
      return mcpText({
        commitment: {
          commitmentSubject: args.commitmentSubject,
          sourceKind,
          sourceSubject,
          donor,
          recipient,
          token: tok,
          totalAmount: totalAmount.toString(),
          releasedAmount: releasedAmount.toString(),
          status: STATUS_LABEL[status.toLowerCase()] ?? 'unknown',
          statusHash: status,
        },
      })
    } catch {
      return mcpText({ commitment: null })
    }
  },
}

// ─── Tool: commitment:list ─────────────────────────────────────────────

interface ListArgs {
  token: string
  /** Optional filter — only rows where donor matches. */
  donor?: Address
  /** Optional filter — only rows where recipient matches. */
  recipient?: Address
  /** Optional limit (default 50). */
  limit?: number
}

const listTool = {
  name: 'commitment:list',
  description:
    "List Commitments from CommitmentRegistry, optionally filtered by donor and/or recipient. Scans allSubjects() — capped at limit (default 50).",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token:     { type: 'string' },
      donor:     { type: 'string' },
      recipient: { type: 'string' },
      limit:     { type: 'integer' },
    },
    required: ['token'],
  },
  handler: async (args: ListArgs) => {
    await requireOrgPrincipal(args.token, args, 'commitment:list')
    const target = requireCommitmentRegistryAddress()
    const pub = getPublicClient()
    const limit = args.limit ?? 50
    let subjects: Hex[] = []
    try {
      subjects = await pub.readContract({
        address: target, abi: commitmentRegistryAbi, functionName: 'allSubjects',
      }) as Hex[]
    } catch {
      return mcpText({ commitments: [] })
    }
    const rows: Array<Record<string, unknown>> = []
    for (const subj of subjects.slice(0, Math.max(limit * 2, 200))) {
      try {
        const tuple = await pub.readContract({
          address: target, abi: commitmentRegistryAbi,
          functionName: 'getCommitment',
          args: [subj],
        }) as readonly [Hex, Hex, Address, Address, Address, bigint, bigint, Hex]
        const [sourceKind, sourceSubject, donor, recipient, tok, totalAmount, releasedAmount, status] = tuple
        if (donor === '0x0000000000000000000000000000000000000000') continue
        if (args.donor && donor.toLowerCase() !== args.donor.toLowerCase()) continue
        if (args.recipient && recipient.toLowerCase() !== args.recipient.toLowerCase()) continue
        rows.push({
          commitmentSubject: subj,
          sourceKind,
          sourceSubject,
          donor,
          recipient,
          token: tok,
          totalAmount: totalAmount.toString(),
          releasedAmount: releasedAmount.toString(),
          status: STATUS_LABEL[status.toLowerCase()] ?? 'unknown',
        })
        if (rows.length >= limit) break
      } catch { /* skip */ }
    }
    return mcpText({ commitments: rows })
  },
}

export const commitmentTools = {
  'commitment:commit': commitTool,
  'commitment:record_release': recordReleaseTool,
  'commitment:record_outcome': recordOutcomeTool,
  'commitment:cancel': cancelTool,
  'commitment:get': getTool,
  'commitment:list': listTool,
}
