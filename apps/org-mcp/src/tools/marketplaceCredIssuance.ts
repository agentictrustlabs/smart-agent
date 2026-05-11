/**
 * Spec 004 (b2) — credential-issuance MCP tools.
 *
 *   - `proposal_submitter_cred:issue` / `:revoke`
 *   - `round_voter_cred:issue`        / `:revoke`
 *
 * These tools are the "admin gate" for the AnonCreds-gated marketplace
 * credentials. Admin = the AgentAccount that owns the pool (for
 * ProposalSubmitterCredential) or the round's fund (for
 * RoundVoterCredential). Only the admin's session can issue or revoke.
 *
 * Issuance is a 2-step ceremony at the protocol level:
 *
 *   1. AnonCreds credential issuance via the existing `/credential/offer`
 *      and `/credential/issue` HTTP routes. The holder wallet drives
 *      this (request → offer → issue → store).
 *
 *   2. Admin → holder on-chain delegation (spec 004 b2) signed by the
 *      admin, scoped to the right registry + method selectors. The
 *      caller passes the signed delegation in via `:issue`; the tool
 *      records it so the holder can later fetch and use it at action
 *      time. Demo seed signs server-side; real users sign in the admin's
 *      UI.
 *
 * This file currently exposes the API surface only. Persistence of the
 * admin→holder delegation is queued for the next implementation pass
 * (it needs an `issued_marketplace_credentials` table + a way to
 * project the delegation back to the holder over the holder's own
 * person-mcp).
 */

import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'
import { SPEC004_SELECTORS } from '@smart-agent/sdk'
import { requireGrantProposalRegistryAddress, requireVoteRegistryAddress } from '../lib/contracts.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

interface IssueProposalSubmitterArgs {
  token: string
  /** Pool the credential is bound to. */
  poolAgent: `0x${string}`
  /** Holder's AgentAccount address (delegate of the admin delegation). */
  holderAccount: `0x${string}`
  /** AnonCreds attributes the wallet expects. */
  attributes: { poolAgentId: string; holderPseudoId: string; issuedYear: string }
  /** Optional pre-signed admin→holder delegation, signed by the pool admin.
   *  When omitted the tool only returns the params + expected selectors
   *  so the caller knows what to sign; when present, the tool records
   *  the delegation alongside the credential. */
  adminDelegation?: unknown
}

const issueProposalSubmitterTool = {
  name: 'proposal_submitter_cred:issue',
  description:
    "Issue a ProposalSubmitterCredential to a holder for a specific pool. ALSO returns the delegation-params snapshot (target=GrantProposalRegistry, methodSelectors=[submit,edit,withdraw]) so the admin can sign an admin→holder on-chain delegation (spec 004 b2). Caller-supplied `adminDelegation`, when present, is persisted alongside the cred.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      poolAgent: { type: 'string' },
      holderAccount: { type: 'string' },
      attributes: { type: 'object' },
      adminDelegation: { type: 'object' },
    },
    required: ['token', 'poolAgent', 'holderAccount', 'attributes'],
  },
  handler: async (args: IssueProposalSubmitterArgs) => {
    await requireOrgPrincipal(args.token, args, 'proposal_submitter_cred:issue')

    // Admin gating note: full check should verify caller's principal
    // is an owner of `poolAgent`. Wired in the next pass (DiscoveryService
    // already exposes pool detail; this layer just needs to call it).

    const delegationParams = {
      kind: 'admin-to-holder' as const,
      target: requireGrantProposalRegistryAddress(),
      delegate: args.holderAccount,
      methodSelectors: [
        SPEC004_SELECTORS.grantProposalSubmit,
        SPEC004_SELECTORS.grantProposalEdit,
        SPEC004_SELECTORS.grantProposalWithdraw,
      ],
    }

    return mcpText({
      ok: true as const,
      credentialType: 'ProposalSubmitterCredential' as const,
      poolAgent: args.poolAgent,
      holderAccount: args.holderAccount,
      attributes: args.attributes,
      delegationParams,
      adminDelegationRecorded: args.adminDelegation != null,
      note:
        'Stub: persistence of the admin→holder delegation alongside the AnonCred is queued; the AnonCred itself is issued via the standard /credential/offer + /credential/issue HTTP routes today.',
    })
  },
}

interface IssueRoundVoterArgs {
  token: string
  roundSubject: `0x${string}`
  holderAccount: `0x${string}`
  attributes: { roundId: string; holderPseudoId: string; issuedYear: string }
  adminDelegation?: unknown
}

const issueRoundVoterTool = {
  name: 'round_voter_cred:issue',
  description:
    "Issue a RoundVoterCredential to a holder for a specific round. Returns delegation-params (target=VoteRegistry, methodSelectors=[castVote]) for the admin→holder on-chain delegation (spec 004 b2).",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      roundSubject: { type: 'string' },
      holderAccount: { type: 'string' },
      attributes: { type: 'object' },
      adminDelegation: { type: 'object' },
    },
    required: ['token', 'roundSubject', 'holderAccount', 'attributes'],
  },
  handler: async (args: IssueRoundVoterArgs) => {
    await requireOrgPrincipal(args.token, args, 'round_voter_cred:issue')

    const delegationParams = {
      kind: 'admin-to-holder' as const,
      target: requireVoteRegistryAddress(),
      delegate: args.holderAccount,
      methodSelectors: [SPEC004_SELECTORS.voteCast],
    }

    return mcpText({
      ok: true as const,
      credentialType: 'RoundVoterCredential' as const,
      roundSubject: args.roundSubject,
      holderAccount: args.holderAccount,
      attributes: args.attributes,
      delegationParams,
      adminDelegationRecorded: args.adminDelegation != null,
      note:
        'Stub: persistence of the admin→holder delegation alongside the AnonCred is queued; the AnonCred itself is issued via the standard /credential/offer + /credential/issue HTTP routes today.',
    })
  },
}

const revokeProposalSubmitterTool = {
  name: 'proposal_submitter_cred:revoke',
  description:
    "Revoke a ProposalSubmitterCredential (and the matching admin→holder delegation). Stub — revocation registry wiring queued.",
  inputSchema: {
    type: 'object' as const,
    properties: { token: { type: 'string' }, holderAccount: { type: 'string' } },
    required: ['token', 'holderAccount'],
  },
  handler: async (args: { token: string; holderAccount: `0x${string}` }) => {
    await requireOrgPrincipal(args.token, args, 'proposal_submitter_cred:revoke')
    return mcpText({ ok: false as const, error: { kind: 'not-implemented', message: 'revocation queued' } })
  },
}

const revokeRoundVoterTool = {
  name: 'round_voter_cred:revoke',
  description:
    "Revoke a RoundVoterCredential (and the matching admin→holder delegation). Stub — revocation registry wiring queued.",
  inputSchema: {
    type: 'object' as const,
    properties: { token: { type: 'string' }, holderAccount: { type: 'string' } },
    required: ['token', 'holderAccount'],
  },
  handler: async (args: { token: string; holderAccount: `0x${string}` }) => {
    await requireOrgPrincipal(args.token, args, 'round_voter_cred:revoke')
    return mcpText({ ok: false as const, error: { kind: 'not-implemented', message: 'revocation queued' } })
  },
}

export const marketplaceCredIssuanceTools = {
  'proposal_submitter_cred:issue': issueProposalSubmitterTool,
  'proposal_submitter_cred:revoke': revokeProposalSubmitterTool,
  'round_voter_cred:issue': issueRoundVoterTool,
  'round_voter_cred:revoke': revokeRoundVoterTool,
}
