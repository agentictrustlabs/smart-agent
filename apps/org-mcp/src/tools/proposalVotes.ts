/**
 * Sprint A — DAO governance voting tools.
 *
 * Per output/voting-and-admin-plan.md. v1 supports the `steward-quorum`
 * strategy: stewards cast approve/reject/abstain ballots; tally is the
 * count of approve votes; threshold N from `rounds.voting_threshold`
 * decides which proposals win.
 *
 * Auth: token must be a valid org-mcp delegation. Eligibility (e.g.,
 * "is this voter a steward?") is checked at the action layer because
 * it requires `canManageAgent` against on-chain state.
 *
 * Tools registered:
 *   - vote:cast               UPSERT — voters can change their vote pre-finalize
 *   - vote:list_for_round     all ballots on a round (for tally + audit)
 *   - vote:list_for_proposal  ballots on a single proposal
 *   - vote:tally_for_round    computed: per-proposal {approve, reject, abstain} counts
 *   - vote:list_for_voter     ballots a voter has cast (for "Votes I cast" view)
 */
import { randomUUID } from 'node:crypto'
import { readVotingConfigFromChain } from './rounds.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'
import { VoteRegistryClient, type Ballot } from '@smart-agent/sdk'
import { callA2aRedeemWithChain, type SignedDelegation } from '../lib/a2a-client.js'
import { requireVoteRegistryAddress } from '../lib/contracts.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

function nowIso(): string {
  return new Date().toISOString()
}

interface CastVoteArgs {
  token: string
  /** Round subject (bytes32 hex) — computed by the action layer from
   *  the round's URN via FundRegistry.roundSubject. */
  roundSubject: `0x${string}`
  /** Proposal subject (bytes32 hex) — computed from
   *  GrantProposalRegistry.gpSubject(roundSubject, proposalNullifier).
   *  The action layer resolves the chosen proposal to its subject when
   *  the voter picks it from the list. */
  proposalSubject: `0x${string}`
  vote: Ballot
  weight?: number
  rationale?: string
  /** REQUIRED — RoundVoterCredential presentation. There is no
   *  principal-gated fallback (spec 004 no-fallback decision). */
  presentation: {
    presentationJson: string
    presentationRequest: Record<string, unknown>
  }
  /** REQUIRED for spec 004 (b2) chained-delegation auth. The voter
   *  has the admin's signed `admin → voter` delegation in their wallet
   *  from credential-issuance time; the web client mints a fresh
   *  short-lived `voter → session` leaf and stacks both here. Root
   *  first, leaf last. Leaf delegate MUST equal the a2a session key. */
  chain: SignedDelegation[]
  _a2aSessionId?: string
}

const castVoteTool = {
  name: 'vote:cast',
  description:
    "Cast or update a ballot on a proposal. Writes the row to VoteRegistry on chain (nullifier-keyed; no voter identity stored). REQUIRES a RoundVoterCredential presentation — no principal-gated fallback (spec 004).",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundSubject: { type: 'string' },
      proposalSubject: { type: 'string' },
      vote: { type: 'string', enum: ['approve', 'reject', 'abstain'] },
      weight: { type: 'integer' },
      rationale: { type: 'string' },
      presentation: {
        type: 'object',
        properties: {
          presentationJson: { type: 'string' },
          presentationRequest: { type: 'object' },
        },
        required: ['presentationJson', 'presentationRequest'],
      },
      chain: {
        type: 'array',
        items: { type: 'object' },
      },
    },
    required: ['token', 'roundSubject', 'proposalSubject', 'vote', 'presentation', 'chain'],
  },
  handler: async (args: CastVoteArgs) => {
    await requireOrgPrincipal(args.token, args, 'vote:cast')

    // ─── Verify AnonCreds presentation ────────────────────────────
    // No fallback — every vote must be backed by a verified
    // RoundVoterCredential. The org-mcp gateway derives the
    // nullifier deterministically from the credential's
    // holderPseudoId + `vote:${roundSubject}`; the chain trusts the
    // gateway as publisher.
    const { verifyPresentation } = await import('../auth/verify-presentation.js')
    const { resolveOnChainResolver } = await import('../auth/on-chain-resolver.js')
    // Spec 004 v2 — the credential MUST bind `roundSubject` to the same
    // round this vote targets. Without this, any RoundVoterCredential
    // for any round would satisfy the proof (high-severity gap caught
    // in review). The verifier matches the revealed `roundSubject`
    // attribute exactly against the action's `args.roundSubject`.
    const result = await verifyPresentation({
      resolver: resolveOnChainResolver(),
      credentialType: 'RoundVoterCredential',
      presentationJson: args.presentation.presentationJson,
      presentationRequest: args.presentation.presentationRequest,
      expectedAttributes: { roundSubject: args.roundSubject },
      nullifierContext: `vote:${args.roundSubject}`,
    })
    if (!result.ok) {
      return mcpText({ ok: false as const, error: `presentation rejected: ${result.error}` })
    }

    // ─── Encode the on-chain write ────────────────────────────────
    // Spec 004 (b2) chained auth: the redeem chain is
    //   [admin → voter, voter → session]
    // signed at credential-issuance time (admin leg) + at action time
    // (voter leg, freshly minted with `authority = hash(admin→voter)`
    // so DelegationManager threads them). DelegationManager dispatches
    // root-down ending at `admin.execute(VoteRegistry, ...)`, so
    // msg.sender at the registry = admin's AgentAccount.
    // `onlyRoundOperator(roundSubject)` then passes because admin IS
    // a registered owner of the round's fund AgentAccount (standard
    // fund:open flow).
    const sessionId = args._a2aSessionId
    if (!sessionId) {
      return mcpText({ ok: false as const, error: '_a2aSessionId missing — vote:cast requires the a2a-agent session id' })
    }
    if (!Array.isArray(args.chain) || args.chain.length === 0) {
      return mcpText({ ok: false as const, error: 'chain missing — vote:cast requires the admin→voter→session delegation chain (spec 004 b2)' })
    }
    const callData = VoteRegistryClient.encodeCastVote({
      roundSubject: args.roundSubject,
      nullifier: result.nullifierHash as `0x${string}`,
      proposalSubject: args.proposalSubject,
      ballot: args.vote,
      weight: BigInt(args.weight ?? 1),
      rationale: args.rationale ?? '',
    })
    const tx = await callA2aRedeemWithChain(sessionId, {
      mcpTool: 'vote:cast',
      mcpCallId: randomUUID(),
      target: requireVoteRegistryAddress(),
      value: 0n,
      callData,
      chain: args.chain,
    })
    return mcpText({
      ok: true as const,
      txHash: tx.txHash,
      nullifier: result.nullifierHash,
      anonymous: true as const,
    })
  },
}

// Spec 004 — the `proposal_votes` SQL mirror is dropped. Ballots are
// authoritative on chain in `VoteRegistry`. These read tools return
// empty arrays until the on-chain → GraphDB sync (R8) lands; the UI
// reads tallies directly from VoteRegistry events or the GraphDB
// mirror once available.
const listForRoundTool = {
  name: 'vote:list_for_round',
  description:
    'STUB — `proposal_votes` SQL mirror dropped; ballots live on chain in VoteRegistry. Returns empty until GraphDB sync (R8) ships.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
    },
    required: ['token', 'roundId'],
  },
  handler: async (args: { token: string; roundId: string }) => {
    await requireOrgPrincipal(args.token, args, 'vote:list_for_round')
    try {
      const { readVotesForRound } = await import('../lib/vote-reader.js')
      const votes = await readVotesForRound(args.roundId)
      return mcpText({ votes })
    } catch (e) {
      console.warn('[vote:list_for_round] reader failed:', (e as Error).message)
      return mcpText({ votes: [] })
    }
  },
}

const listForProposalTool = {
  name: 'vote:list_for_proposal',
  description: 'Read ballots cast for a specific proposal from VoteRegistry.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      proposalId: { type: 'string' },
    },
    required: ['token', 'proposalId'],
  },
  handler: async (args: { token: string; proposalId: string }) => {
    await requireOrgPrincipal(args.token, args, 'vote:list_for_proposal')
    try {
      const { readVotesForProposal } = await import('../lib/vote-reader.js')
      const votes = await readVotesForProposal(args.proposalId)
      return mcpText({ votes })
    } catch (e) {
      console.warn('[vote:list_for_proposal] reader failed:', (e as Error).message)
      return mcpText({ votes: [] })
    }
  },
}

const listForVoterTool = {
  name: 'vote:list_for_voter',
  description: 'Read ballots cast by the calling voter (matched by nullifier).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      voterAgentId: { type: 'string' },
    },
    required: ['token', 'voterAgentId'],
  },
  // The on-chain voter is identified only by a per-round nullifier (no
  // principal). The caller passes their voterAgentId; we derive the
  // expected nullifier for each round encountered and match.
  handler: async (args: { token: string; voterAgentId: string }) => {
    const principal = await requireOrgPrincipal(args.token, args, 'vote:list_for_voter')
    try {
      const { readAllVotes } = await import('../lib/vote-reader.js')
      const { keccak256, encodePacked } = await import('viem')
      const all = await readAllVotes()
      // Per-round nullifier for the calling principal — cached.
      const cache = new Map<string, string>()
      const filtered = all.filter((v) => {
        const key = v.roundSubject.toLowerCase()
        let n = cache.get(key)
        if (!n) {
          n = keccak256(encodePacked(['string', 'string', 'bytes32'], ['sa:voter:', principal.toLowerCase(), v.roundSubject])).toLowerCase()
          cache.set(key, n)
        }
        return v.nullifier.toLowerCase() === n
      })
      return mcpText({ votes: filtered })
    } catch (e) {
      console.warn('[vote:list_for_voter] reader failed:', (e as Error).message)
      return mcpText({ votes: [] })
    }
  },
}

interface TallyEntry {
  proposalId: string
  approves: number
  rejects: number
  abstains: number
  totalWeight: number  // sum of approve weights (for non-flat strategies later)
  passes: boolean      // approves >= round.votingThreshold
}

const tallyForRoundTool = {
  name: 'vote:tally_for_round',
  description:
    'Compute the per-proposal tally for a round. Returns approve/reject/abstain counts and a `passes` flag derived from the round\'s votingThreshold.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundId: { type: 'string' },
    },
    required: ['token', 'roundId'],
  },
  // R8 — compute the per-proposal tally directly from VoteRegistry.
  handler: async (args: { token: string; roundId: string }) => {
    await requireOrgPrincipal(args.token, args, 'vote:tally_for_round')
    const cfg = await readVotingConfigFromChain(args.roundId)
    let tally: TallyEntry[] = []
    try {
      const { tallyForRound } = await import('../lib/vote-reader.js')
      tally = await tallyForRound(args.roundId, cfg.votingThreshold)
    } catch (e) {
      console.warn('[vote:tally_for_round] reader failed:', (e as Error).message)
    }
    return mcpText({
      tally,
      threshold: cfg.votingThreshold,
      strategy: cfg.votingStrategy,
      windowStartsAt: cfg.votingWindowStartsAt,
      windowEndsAt: cfg.votingWindowEndsAt,
    })
  },
}

export const proposalVotesTools = {
  'vote:cast': castVoteTool,
  'vote:list_for_round': listForRoundTool,
  'vote:list_for_proposal': listForProposalTool,
  'vote:list_for_voter': listForVoterTool,
  'vote:tally_for_round': tallyForRoundTool,
}
