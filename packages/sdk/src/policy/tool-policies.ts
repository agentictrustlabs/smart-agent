/**
 * ToolPolicyRegistry — first-party tool risk tiering + execution path mapping.
 *
 * Source of truth for: which MCP tool runs in which delegation execution path.
 * Used by:
 *   - apps/web/src/lib/actions/a2a-session.action.ts (build root delegation
 *     caveats: union of all (allowedTargets, allowedSelectors) across policies).
 *   - apps/a2a-agent endpoints to validate inbound MCP redeem requests
 *     (target/selector must be in the requesting tool's policy).
 *   - apps/org-mcp + apps/person-mcp tools to decide routine vs sub-delegated path.
 *
 * Risk tiers:
 *   routine    — low-risk, frequent, short-lived. Stateless caveat-composition path.
 *   sensitive  — irreversible / asset-affecting. Per-call sub-delegation with
 *                task-binding + calldata-hash + single-use nonce.
 *   stateful   — needs durable policy state (spend caps, budgets, runtime updates).
 *                ERC-7579 SessionAgentAccount + first-party modules.
 *
 * Execution paths:
 *   mcp-only           — no on-chain side; MCP performs SQL/business work only.
 *   stateless-redeem   — a2a-agent's session EOA redeems user's root delegation.
 *   sub-delegated      — a2a-agent mints a per-call D_sub; tool executor redeems
 *                        [D_sub, D_root] chain.
 *   session-account    — routes through a deployed SessionAgentAccount with
 *                        installed first-party modules.
 *
 * Adding a new MCP tool: add a policy entry here. Without one, the tool is
 * rejected at the a2a-agent boundary.
 */
import type { Address, Hex } from 'viem'

export type RiskTier = 'routine' | 'sensitive' | 'stateful'

export type ExecutionPath =
  | 'mcp-only'
  | 'stateless-redeem'
  | 'sub-delegated'
  | 'session-account'

export interface ToolPolicy {
  /** Canonical tool name as registered in the MCP server. */
  toolId: string

  /** Owning MCP server — multiple servers may host the same tool name in theory;
   *  we key on (mcpServer, toolId) to keep policies unambiguous. */
  mcpServer: 'org-mcp' | 'person-mcp' | 'family-mcp' | 'people-group-mcp' | 'verifier-mcp' | 'skill-mcp' | 'geo-mcp'

  /** Coarse risk classification. Drives executionPath. */
  riskTier: RiskTier

  /** Concrete execution path. */
  executionPath: ExecutionPath

  /** On-chain targets this tool may invoke. Empty array for mcp-only paths. */
  allowedTargets: Array<'PoolRegistry' | 'FundRegistry' | 'AgentAccountFactory' | 'GrantRegistry' | 'ClassAssertionContract' | 'AgentRelationship' | 'AgentAccountResolver' | 'VoteRegistry' | 'GrantProposalRegistry' | 'PledgeRegistry' | 'MatchInitiationRegistry'>

  /** 4-byte function selectors callable on the targets. Empty for mcp-only. */
  allowedSelectors: Hex[]

  /** Max ETH (wei) per call. 0 for typed-attr writes. */
  maxValueWei: bigint

  /** Sensitive-tier requirement: D_sub must encode the a2aTaskId. */
  requiresTaskBinding: boolean

  /** Sensitive-tier requirement: D_sub locks to keccak256(callData). */
  requiresCalldataHash: boolean

  /** Future Phase 4: surface to user before signing. */
  requiresHumanConfirmation: boolean

  /** Chain restriction. */
  allowedChains: number[]
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Function selectors from the deployed registry/contract ABIs. Computed at
 *  runtime by the action layer via viem's `toFunctionSelector`. We list the
 *  function names here; the bootstrap code maps name → selector against the
 *  imported ABI. */
export const POOL_REGISTRY_SELECTORS_BY_TOOL: Record<string, string[]> = {
  'pool:create':                    ['open'],
  'pool:close':                     ['close'],
  'pool:update_mandate':            ['updateMandate'],
  'pool:rotate_stewards':           ['rotateStewards'],
  'pool:set_accepted_restrictions': ['setAcceptedRestrictions'],
}

export const FUND_REGISTRY_SELECTORS_BY_TOOL: Record<string, string[]> = {
  'round:open':           ['openRound'],
  'round:set_status':     ['setRoundStatus'],
  'round:close':          ['setRoundStatus'],   // close = transition status to closed
  'round:cancel':         ['setRoundStatus'],   // cancel = transition status to canceled
  'round:set_awards_root': ['setRoundAwardsRoot'],
  // round:update_voting_config / round:increment_proposals_received are MCP-only
  // (voting config is off-chain DAO state per the design).
}

// ─── Default-mcp-only policy template ────────────────────────────────

function mcpOnly(toolId: string, mcpServer: ToolPolicy['mcpServer']): ToolPolicy {
  return {
    toolId,
    mcpServer,
    riskTier: 'routine',
    executionPath: 'mcp-only',
    allowedTargets: [],
    allowedSelectors: [],
    maxValueWei: 0n,
    requiresTaskBinding: false,
    requiresCalldataHash: false,
    requiresHumanConfirmation: false,
    allowedChains: [31337, 11155111],
  }
}

function statelessRedeem(
  toolId: string,
  mcpServer: ToolPolicy['mcpServer'],
  target: ToolPolicy['allowedTargets'][number],
  // selectors filled in at runtime from the policy table above
): ToolPolicy {
  return {
    toolId,
    mcpServer,
    riskTier: 'routine',
    executionPath: 'stateless-redeem',
    allowedTargets: [target],
    allowedSelectors: [],  // populated at session-bootstrap time from POOL/FUND_REGISTRY_SELECTORS_BY_TOOL
    maxValueWei: 0n,
    requiresTaskBinding: false,
    requiresCalldataHash: false,
    requiresHumanConfirmation: false,
    allowedChains: [31337, 11155111],
  }
}

function subDelegated(
  toolId: string,
  mcpServer: ToolPolicy['mcpServer'],
  target: ToolPolicy['allowedTargets'][number],
  requiresHuman = false,
): ToolPolicy {
  return {
    toolId,
    mcpServer,
    riskTier: 'sensitive',
    executionPath: 'sub-delegated',
    allowedTargets: [target],
    allowedSelectors: [],  // populated at session-bootstrap time
    maxValueWei: 0n,
    requiresTaskBinding: true,
    requiresCalldataHash: true,
    requiresHumanConfirmation: requiresHuman,
    allowedChains: [31337, 11155111],
  }
}

// ─── Tool policy registry ────────────────────────────────────────────

export const TOOL_POLICIES: Record<string, ToolPolicy> = {
  // ─── org-mcp: MCP-only (no on-chain) ───────────────────────────────
  'org_profile:upsert':            mcpOnly('org_profile:upsert', 'org-mcp'),
  'detached_member:list':          mcpOnly('detached_member:list', 'org-mcp'),
  'detached_member:add':           mcpOnly('detached_member:add', 'org-mcp'),
  'detached_member:delete':        mcpOnly('detached_member:delete', 'org-mcp'),
  'revenue:submit':                mcpOnly('revenue:submit', 'org-mcp'),
  'revenue:approve':               mcpOnly('revenue:approve', 'org-mcp'),
  'revenue:list':                  mcpOnly('revenue:list', 'org-mcp'),
  'activity:log':                  mcpOnly('activity:log', 'org-mcp'),
  'activity:list':                 mcpOnly('activity:list', 'org-mcp'),
  'intent:create':                 mcpOnly('intent:create', 'org-mcp'),
  'intent:list':                   mcpOnly('intent:list', 'org-mcp'),
  'intent:bump_ack_count':         mcpOnly('intent:bump_ack_count', 'org-mcp'),
  'notification:list':             mcpOnly('notification:list', 'org-mcp'),
  'notification:mark_read':        mcpOnly('notification:mark_read', 'org-mcp'),
  'belief:list':                   mcpOnly('belief:list', 'org-mcp'),
  'belief:upsert':                 mcpOnly('belief:upsert', 'org-mcp'),
  'work_item:list':                mcpOnly('work_item:list', 'org-mcp'),
  'work_item:create':              mcpOnly('work_item:create', 'org-mcp'),
  'engagement:upsert_provider_state': mcpOnly('engagement:upsert_provider_state', 'org-mcp'),
  'pool_pledge:read_self':         mcpOnly('pool_pledge:read_self', 'org-mcp'),
  'pool_pledge:read_pool_counters': mcpOnly('pool_pledge:read_pool_counters', 'org-mcp'),
  'pool_pledge:list_for_pool':     mcpOnly('pool_pledge:list_for_pool', 'org-mcp'),
  // Spec 004 — pool pledges write on chain via PledgeRegistry, gated by
  // the admin→donor→session chain. Stateless-redeem path applies.
  'pool_pledge:submit':            statelessRedeem('pool_pledge:submit', 'org-mcp', 'PledgeRegistry'),
  'pool_pledge:amend':             statelessRedeem('pool_pledge:amend', 'org-mcp', 'PledgeRegistry'),
  'pool_pledge:stop':              statelessRedeem('pool_pledge:stop', 'org-mcp', 'PledgeRegistry'),
  'pool_pledge:auto_stop':         statelessRedeem('pool_pledge:auto_stop', 'org-mcp', 'PledgeRegistry'),
  'match_initiation:create':       statelessRedeem('match_initiation:create', 'org-mcp', 'MatchInitiationRegistry'),
  'match_initiation:read':         mcpOnly('match_initiation:read', 'org-mcp'),
  'match_initiation:consume':      statelessRedeem('match_initiation:consume', 'org-mcp', 'MatchInitiationRegistry'),
  'match_initiation:supersede':    statelessRedeem('match_initiation:supersede', 'org-mcp', 'MatchInitiationRegistry'),
  'grant_proposal:draft':          mcpOnly('grant_proposal:draft', 'org-mcp'),
  // Spec 004 — grant proposal submit/edit/withdraw write on chain via
  // GrantProposalRegistry, gated by the AnonCreds presentation + chain.
  'grant_proposal:edit_pre_deadline': statelessRedeem('grant_proposal:edit_pre_deadline', 'org-mcp', 'GrantProposalRegistry'),
  'grant_proposal:submit':         statelessRedeem('grant_proposal:submit', 'org-mcp', 'GrantProposalRegistry'),
  'grant_proposal:withdraw':       statelessRedeem('grant_proposal:withdraw', 'org-mcp', 'GrantProposalRegistry'),
  'grant_proposal:clone':          mcpOnly('grant_proposal:clone', 'org-mcp'),
  'grant_proposal:read_self':      mcpOnly('grant_proposal:read_self', 'org-mcp'),
  'grant_proposal:list_for_member': mcpOnly('grant_proposal:list_for_member', 'org-mcp'),
  'grant_proposal:list_for_round': mcpOnly('grant_proposal:list_for_round', 'org-mcp'),
  'grant_proposal:count_for_round': mcpOnly('grant_proposal:count_for_round', 'org-mcp'),
  'grant_proposal:rescind':        mcpOnly('grant_proposal:rescind', 'org-mcp'),
  'round:get_voting_config':       mcpOnly('round:get_voting_config', 'org-mcp'),
  'round:update_voting_config':    mcpOnly('round:update_voting_config', 'org-mcp'),
  'round:increment_proposals_received': mcpOnly('round:increment_proposals_received', 'org-mcp'),
  // Spec 004 — vote:cast writes on chain via VoteRegistry, gated by the
  // AnonCreds presentation + admin→voter→session chain.
  'vote:cast':                     statelessRedeem('vote:cast', 'org-mcp', 'VoteRegistry'),
  'vote:list_for_proposal':        mcpOnly('vote:list_for_proposal', 'org-mcp'),
  'vote:list_for_round':           mcpOnly('vote:list_for_round', 'org-mcp'),
  'vote:list_for_voter':           mcpOnly('vote:list_for_voter', 'org-mcp'),
  'vote:tally_for_round':          mcpOnly('vote:tally_for_round', 'org-mcp'),

  // ─── org-mcp: routine on-chain (stateless redeem path) ─────────────
  'pool:create':                    statelessRedeem('pool:create', 'org-mcp', 'PoolRegistry'),
  'pool:update_mandate':            statelessRedeem('pool:update_mandate', 'org-mcp', 'PoolRegistry'),
  'pool:rotate_stewards':           statelessRedeem('pool:rotate_stewards', 'org-mcp', 'PoolRegistry'),
  'pool:set_accepted_restrictions': statelessRedeem('pool:set_accepted_restrictions', 'org-mcp', 'PoolRegistry'),
  'round:open':                     statelessRedeem('round:open', 'org-mcp', 'FundRegistry'),
  'round:set_status':               statelessRedeem('round:set_status', 'org-mcp', 'FundRegistry'),

  // ─── org-mcp: sensitive on-chain (sub-delegated path) ──────────────
  // Promoted: irreversible/asset-affecting actions that warrant per-call
  // narrower authority + task-binding + calldata-hash + single-use.
  'pool:close':                     subDelegated('pool:close', 'org-mcp', 'PoolRegistry'),
  'round:close':                    subDelegated('round:close', 'org-mcp', 'FundRegistry'),
  'round:cancel':                   subDelegated('round:cancel', 'org-mcp', 'FundRegistry'),
  'round:set_awards_root':          subDelegated('round:set_awards_root', 'org-mcp', 'FundRegistry', /* requiresHuman */ true),
  'disbursement:claim':             subDelegated('disbursement:claim', 'org-mcp', 'FundRegistry'),
  'disbursement:record':            mcpOnly('disbursement:record', 'org-mcp'),
  'disbursement:mark_paid':         mcpOnly('disbursement:mark_paid', 'org-mcp'),
  'disbursement:list_for_proposal': mcpOnly('disbursement:list_for_proposal', 'org-mcp'),
  'disbursement:list_for_recipient': mcpOnly('disbursement:list_for_recipient', 'org-mcp'),
  'attestation:cast':               mcpOnly('attestation:cast', 'org-mcp'),
  'attestation:list_for_proposal':  mcpOnly('attestation:list_for_proposal', 'org-mcp'),
  'grant_proposal:award':           subDelegated('grant_proposal:award', 'org-mcp', 'FundRegistry', /* requiresHuman */ true),
  'grant_proposal:revoke_award':    subDelegated('grant_proposal:revoke_award', 'org-mcp', 'FundRegistry'),
  'proposal:read_for_review':       mcpOnly('proposal:read_for_review', 'org-mcp'),
  'round:read_addressed_list':      mcpOnly('round:read_addressed_list', 'org-mcp'),

  // ─── person-mcp: MCP-only (no on-chain) ─────────────────────────────
  'add_external_identity':       mcpOnly('add_external_identity', 'person-mcp'),
  'add_message':                 mcpOnly('add_message', 'person-mcp'),
  'add_oikos_contact':           mcpOnly('add_oikos_contact', 'person-mcp'),
  'create_notification':         mcpOnly('create_notification', 'person-mcp'),
  'create_thread':               mcpOnly('create_thread', 'person-mcp'),
  'create_work_item':            mcpOnly('create_work_item', 'person-mcp'),
  'delete_belief':               mcpOnly('delete_belief', 'person-mcp'),
  'delete_coaching_note':        mcpOnly('delete_coaching_note', 'person-mcp'),
  'delete_oikos_contact':        mcpOnly('delete_oikos_contact', 'person-mcp'),
  'delete_prayer':               mcpOnly('delete_prayer', 'person-mcp'),
  'express_intent':              mcpOnly('express_intent', 'person-mcp'),
  'get_delegated_profile':       mcpOnly('get_delegated_profile', 'person-mcp'),
  'get_delegated_training_progress': mcpOnly('get_delegated_training_progress', 'person-mcp'),
  'get_intent':                  mcpOnly('get_intent', 'person-mcp'),
  'get_profile':                 mcpOnly('get_profile', 'person-mcp'),
  'get_shared_coaching_notes':   mcpOnly('get_shared_coaching_notes', 'person-mcp'),
  'get_thread':                  mcpOnly('get_thread', 'person-mcp'),
  'get_user_preferences':        mcpOnly('get_user_preferences', 'person-mcp'),
  'grant_cross_delegation':      mcpOnly('grant_cross_delegation', 'person-mcp'),
  'list_activities':             mcpOnly('list_activities', 'person-mcp'),
  'list_beliefs':                mcpOnly('list_beliefs', 'person-mcp'),
  'list_coaching_notes':         mcpOnly('list_coaching_notes', 'person-mcp'),
  'list_cross_delegation_grants': mcpOnly('list_cross_delegation_grants', 'person-mcp'),
  'list_external_identities':    mcpOnly('list_external_identities', 'person-mcp'),
  'list_intents':                mcpOnly('list_intents', 'person-mcp'),
  'list_notifications':          mcpOnly('list_notifications', 'person-mcp'),
  'list_oikos_contacts':         mcpOnly('list_oikos_contacts', 'person-mcp'),
  'list_pinned_items':           mcpOnly('list_pinned_items', 'person-mcp'),
  'list_prayers':                mcpOnly('list_prayers', 'person-mcp'),
  'list_received_delegations':   mcpOnly('list_received_delegations', 'person-mcp'),
  'list_threads':                mcpOnly('list_threads', 'person-mcp'),
  'list_training_progress':      mcpOnly('list_training_progress', 'person-mcp'),
  'list_work_items':             mcpOnly('list_work_items', 'person-mcp'),
  'log_activity':                mcpOnly('log_activity', 'person-mcp'),
  'mark_notification_read':      mcpOnly('mark_notification_read', 'person-mcp'),
  'mark_prayer_response':        mcpOnly('mark_prayer_response', 'person-mcp'),
  'pin_item':                    mcpOnly('pin_item', 'person-mcp'),
  'register_received_delegation': mcpOnly('register_received_delegation', 'person-mcp'),
  'remove_external_identity':    mcpOnly('remove_external_identity', 'person-mcp'),
  'resolve_work_item':           mcpOnly('resolve_work_item', 'person-mcp'),
  'revoke_cross_delegation':     mcpOnly('revoke_cross_delegation', 'person-mcp'),
  'revoke_received_delegation':  mcpOnly('revoke_received_delegation', 'person-mcp'),
  'ssi_create_presentation':     mcpOnly('ssi_create_presentation', 'person-mcp'),
  'ssi_create_wallet_action':    mcpOnly('ssi_create_wallet_action', 'person-mcp'),
  'ssi_finish_credential_exchange': mcpOnly('ssi_finish_credential_exchange', 'person-mcp'),
  'ssi_get_credential_details':  mcpOnly('ssi_get_credential_details', 'person-mcp'),
  'ssi_list_my_credentials':     mcpOnly('ssi_list_my_credentials', 'person-mcp'),
  'ssi_list_proof_audit':        mcpOnly('ssi_list_proof_audit', 'person-mcp'),
  'ssi_list_wallets':            mcpOnly('ssi_list_wallets', 'person-mcp'),
  'ssi_match_against_public_set': mcpOnly('ssi_match_against_public_set', 'person-mcp'),
  'ssi_provision_wallet':        mcpOnly('ssi_provision_wallet', 'person-mcp'),
  'ssi_rotate_link_secret':      mcpOnly('ssi_rotate_link_secret', 'person-mcp'),
  'ssi_start_credential_exchange': mcpOnly('ssi_start_credential_exchange', 'person-mcp'),
  'toggle_planned_conversation': mcpOnly('toggle_planned_conversation', 'person-mcp'),
  'toggle_training_module':      mcpOnly('toggle_training_module', 'person-mcp'),
  'unpin_item':                  mcpOnly('unpin_item', 'person-mcp'),
  'update_oikos_contact':        mcpOnly('update_oikos_contact', 'person-mcp'),
  'update_profile':              mcpOnly('update_profile', 'person-mcp'),
  'update_user_preferences':     mcpOnly('update_user_preferences', 'person-mcp'),
  'upsert_belief':               mcpOnly('upsert_belief', 'person-mcp'),
  'upsert_coaching_note':        mcpOnly('upsert_coaching_note', 'person-mcp'),
  'upsert_prayer':               mcpOnly('upsert_prayer', 'person-mcp'),
  'withdraw_intent':             mcpOnly('withdraw_intent', 'person-mcp'),
}

// ─── Lookup helpers ──────────────────────────────────────────────────

export function getToolPolicy(toolId: string): ToolPolicy | undefined {
  return TOOL_POLICIES[toolId]
}

export function isOnchainTool(toolId: string): boolean {
  const p = TOOL_POLICIES[toolId]
  return !!p && p.executionPath !== 'mcp-only'
}

export function isSensitiveTool(toolId: string): boolean {
  const p = TOOL_POLICIES[toolId]
  return !!p && p.riskTier === 'sensitive'
}

/** All tool names that have an on-chain side. Used by session bootstrap to
 *  build the AllowedMethods caveat. */
export function listOnchainToolIds(): string[] {
  return Object.keys(TOOL_POLICIES).filter(isOnchainTool)
}

/** Distinct allowed targets across every on-chain tool. Used by session
 *  bootstrap to build the AllowedTargets caveat. */
export function listAllowedTargetSymbols(): ToolPolicy['allowedTargets'][number][] {
  const set = new Set<ToolPolicy['allowedTargets'][number]>()
  for (const p of Object.values(TOOL_POLICIES)) {
    for (const t of p.allowedTargets) set.add(t)
  }
  return Array.from(set)
}

/** All on-chain function names that any tool may invoke. Caller resolves to
 *  selectors via viem's `toFunctionSelector(abi.find(...))`. */
export function listAllowedFunctionNames(): { target: string; functionName: string }[] {
  const out: { target: string; functionName: string }[] = []
  for (const [tool, fns] of Object.entries(POOL_REGISTRY_SELECTORS_BY_TOOL)) {
    if (!isOnchainTool(tool)) continue
    for (const fn of fns) out.push({ target: 'PoolRegistry', functionName: fn })
  }
  for (const [tool, fns] of Object.entries(FUND_REGISTRY_SELECTORS_BY_TOOL)) {
    if (!isOnchainTool(tool)) continue
    for (const fn of fns) out.push({ target: 'FundRegistry', functionName: fn })
  }
  return out
}

/** Resolve a target symbol to an on-chain address from env. */
export function resolveTargetAddress(
  target: ToolPolicy['allowedTargets'][number],
  env: Record<string, string | undefined>,
): Address | undefined {
  switch (target) {
    case 'PoolRegistry':         return env.POOL_REGISTRY_ADDRESS as Address | undefined
    case 'FundRegistry':         return env.FUND_REGISTRY_ADDRESS as Address | undefined
    case 'AgentAccountFactory':  return env.AGENT_FACTORY_ADDRESS as Address | undefined
    case 'GrantRegistry':        return env.GRANT_REGISTRY_ADDRESS as Address | undefined
    case 'ClassAssertionContract': return env.CLASS_ASSERTION_ADDRESS as Address | undefined
    case 'AgentRelationship':    return env.AGENT_RELATIONSHIP_ADDRESS as Address | undefined
    case 'AgentAccountResolver': return env.AGENT_ACCOUNT_RESOLVER_ADDRESS as Address | undefined
    case 'VoteRegistry':           return env.VOTE_REGISTRY_ADDRESS as Address | undefined
    case 'GrantProposalRegistry':  return env.GRANT_PROPOSAL_REGISTRY_ADDRESS as Address | undefined
    case 'PledgeRegistry':         return env.PLEDGE_REGISTRY_ADDRESS as Address | undefined
    case 'MatchInitiationRegistry': return env.MATCH_INITIATION_REGISTRY_ADDRESS as Address | undefined
  }
}
