/**
 * Phase 4 — ProposalRegistry public-facet MCP tools.
 *
 * Routes web-side public-proposal writes (announceAward at round close,
 * status setStatus when an award is revoked/rescinded) through a2a-agent's
 * stateless-redeem path so the web action layer no longer signs them with
 * the deployer wallet.
 *
 * Tools registered:
 *   - proposal_registry:announce_award  — write the public award facet
 *   - proposal_registry:set_status      — flip the public status flag
 *
 * The action layer pairs these with the existing
 * `grant_proposal:award` / `grant_proposal:revoke_award` /
 * `grant_proposal:rescind` MCP tools (which carry the private-row state).
 */
import { encodeFunctionData, keccak256, toBytes, toHex, type Address, type Hex } from 'viem'
import { randomUUID } from 'node:crypto'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'
import { proposalRegistryAbi } from '@smart-agent/sdk'
import { callA2aRedeem } from '../lib/a2a-client.js'
import { requireProposalRegistryAddress } from '../lib/contracts.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

function requireSessionId(args: { _a2aSessionId?: string }): string {
  const id = args._a2aSessionId
  if (!id || typeof id !== 'string') {
    throw new Error('missing _a2aSessionId — Phase 1 requires routing through a2a-agent mcp-proxy')
  }
  return id
}

// ─── Tool: proposal_registry:announce_award ─────────────────────────────

interface AnnounceAwardArgs {
  token: string
  proposalSubject: Hex
  kind?: string                    // CURIE — defaults to 'sa:GivingKind'
  basedOnIntentId?: Hex            // bytes32 hash; zero-bytes for none
  roundSubject: Hex
  proposer?: Address
  recipient: Address
  totalAwarded: string             // decimal bigint string
  bodyHash: Hex
  awardingFund: Address
  status?: string                  // CURIE; defaults to 'sa:ProposalAwarded'
  needIntentIdString?: string      // URN form for emitter back-ref
  _a2aSessionId?: string
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address
const ZERO_BYTES32 = ('0x' + '0'.repeat(64)) as Hex

const announceAwardTool = {
  name: 'proposal_registry:announce_award',
  description:
    "Publish a ProposalPublicFacet row (announceAward) on ProposalRegistry. Called by the steward set during round close after AllocationDecided. Routes via a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token:              { type: 'string' },
      proposalSubject:    { type: 'string' },
      kind:               { type: 'string' },
      basedOnIntentId:    { type: 'string' },
      roundSubject:       { type: 'string' },
      proposer:           { type: 'string' },
      recipient:          { type: 'string' },
      totalAwarded:       { type: 'string' },
      bodyHash:           { type: 'string' },
      awardingFund:       { type: 'string' },
      status:             { type: 'string' },
      needIntentIdString: { type: 'string' },
    },
    required: [
      'token', 'proposalSubject', 'roundSubject', 'recipient',
      'totalAwarded', 'bodyHash', 'awardingFund',
    ],
  },
  handler: async (args: AnnounceAwardArgs) => {
    await requireOrgPrincipal(args.token, args, 'proposal_registry:announce_award')
    const sessionId = requireSessionId(args)
    const target = requireProposalRegistryAddress()

    const kindHash = keccak256(toBytes(args.kind ?? 'sa:GivingKind'))
    const statusHash = keccak256(toBytes(args.status ?? 'sa:ProposalAwarded'))
    const basedOn = args.basedOnIntentId ?? (
      args.needIntentIdString
        ? keccak256(toBytes(args.needIntentIdString))
        : ZERO_BYTES32
    )

    const data = encodeFunctionData({
      abi: proposalRegistryAbi,
      functionName: 'announceAward',
      args: [{
        proposalSubject:    args.proposalSubject,
        kind:               kindHash,
        basedOnIntentId:    basedOn,
        round:              args.roundSubject,
        proposer:           args.proposer ?? ZERO_ADDRESS,
        recipient:          args.recipient,
        totalAwarded:       BigInt(args.totalAwarded),
        bodyHash:           args.bodyHash,
        awardingFund:       args.awardingFund,
        status:             statusHash,
        needIntentIdString: args.needIntentIdString ?? '',
      }],
    })
    const r = await callA2aRedeem(sessionId, {
      mcpTool: 'proposal_registry:announce_award',
      mcpCallId: randomUUID(),
      target,
      value: 0n,
      callData: data,
    })
    return mcpText({
      ok: true as const,
      txHash: r.txHash,
      proposalSubject: args.proposalSubject,
    })
  },
}

// ─── Tool: proposal_registry:set_status ─────────────────────────────────

interface SetStatusArgs {
  token: string
  proposalSubject: Hex
  /** CURIE such as 'sa:ProposalAwarded', 'sa:ProposalRevoked', 'sa:ProposalRescinded'. */
  status: string
  _a2aSessionId?: string
}

const setStatusTool = {
  name: 'proposal_registry:set_status',
  description:
    "Flip a proposal's public-facet status on ProposalRegistry. Used by revoke-award / rescind / dispute flows. Routes via a2a-agent's stateless-redeem path.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      proposalSubject: { type: 'string' },
      status: { type: 'string' },
    },
    required: ['token', 'proposalSubject', 'status'],
  },
  handler: async (args: SetStatusArgs) => {
    await requireOrgPrincipal(args.token, args, 'proposal_registry:set_status')
    const sessionId = requireSessionId(args)
    const target = requireProposalRegistryAddress()
    const statusHash = keccak256(toHex(args.status))
    const data = encodeFunctionData({
      abi: proposalRegistryAbi,
      functionName: 'setStatus',
      args: [args.proposalSubject, statusHash],
    })
    const r = await callA2aRedeem(sessionId, {
      mcpTool: 'proposal_registry:set_status',
      mcpCallId: randomUUID(),
      target,
      value: 0n,
      callData: data,
    })
    return mcpText({ ok: true as const, txHash: r.txHash })
  },
}

export const proposalRegistryTools = {
  'proposal_registry:announce_award': announceAwardTool,
  'proposal_registry:set_status': setStatusTool,
}
