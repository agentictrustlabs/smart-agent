/**
 * Spec 004 (b2) — chain-mint helper for marketplace actions.
 *
 * The web action layer calls `resolveSpec004Chain({ targetRegistry, … })`
 * before invoking any AnonCreds-gated marketplace MCP tool. The helper:
 *
 *   1. Looks up the user's marketplace credential + signed admin→holder
 *      delegation via person-mcp's `ssi_get_marketplace_delegation`.
 *   2. Reads the user's a2a session metadata to discover the
 *      `sessionKeyAddress` (the leaf delegate the chain must terminate at).
 *   3. Signs `holder → session` with the user's stored EOA private key
 *      (demo only — real users need a passkey ceremony, see TODO at
 *      bottom).
 *   4. Returns the chain `[admin→holder, holder→session]` ready to pass
 *      to org-mcp tools (vote:cast, grant_proposal:submit/*, pool_pledge:*).
 *
 * Errors are typed so action callers can render a friendly UI on the
 * "no credential issued yet" branch.
 */

import 'server-only'
import {
  signChildDelegation,
  delegationHash,
  buildAdminDelegationCaveats,
  type Spec004SignedDelegation,
} from '@smart-agent/sdk'
import { callMcp } from '@/lib/clients/mcp-client'
import { loadSignerForCurrentUser } from '@/lib/ssi/signer'
import { getA2ASessionToken } from '@/lib/actions/a2a-session.action'
import {
  resolveA2AEndpointForCurrentUser,
  A2AUrlResolverError,
} from '@/lib/clients/a2a-url-resolver'
import { a2aFetch } from '@/lib/clients/a2a-fetch'
import type { Address, Hex } from 'viem'

// ─── Types ───────────────────────────────────────────────────────────

export interface ResolveChainInput {
  targetRegistry: Address
  /** The credential type the action needs to be backed by — used to
   *  disambiguate when a user holds multiple marketplace credentials
   *  against the same registry. Optional; helper falls back to "any
   *  active credential for the registry". */
  credentialType?: 'ProposalSubmitterCredential' | 'RoundVoterCredential'
  /** Function selectors the leaf delegation should authorize. The leaf
   *  is more-restrictive than the admin→holder root, so we pass the
   *  specific selector for the action being taken (e.g.
   *  `SPEC004_SELECTORS.voteCast` for vote:cast). The AllowedMethods
   *  enforcer rejects empty selector lists, so this is required. */
  methodSelectors: Hex[]
}

export interface ResolveChainOk {
  ok: true
  chain: Spec004SignedDelegation[]
  /** Same registry passed in; echoed so the caller doesn't have to
   *  track it across two args. */
  targetRegistry: Address
  /** AnonCreds credential id the chain is bound to (for audit). */
  credentialId: string
}

export type ResolveChainError =
  | { ok: false; error: 'no-eoa-signer'; message: string }
  | { ok: false; error: 'no-a2a-session'; message: string }
  | { ok: false; error: 'no-marketplace-credential'; message: string }
  | { ok: false; error: 'no-admin-delegation'; message: string }
  | { ok: false; error: 'session-status-failed'; message: string }
  | { ok: false; error: 'malformed-admin-delegation'; message: string }
  | { ok: false; error: 'env-missing'; message: string }

// ─── Helpers ─────────────────────────────────────────────────────────

interface SessionStatus {
  active: boolean
  sessionId?: string
  accountAddress?: Address
  sessionKeyAddress?: Address
  reason?: string
}

async function fetchSessionStatus(sessionId: string): Promise<SessionStatus> {
  // /session/:id/status is host-protected (Phase 1). Resolve the current
  // user's A2A endpoint and call through with the right Host header.
  let ep
  try {
    ep = await resolveA2AEndpointForCurrentUser()
  } catch (e) {
    if (e instanceof A2AUrlResolverError) {
      return { active: false, reason: `endpoint-resolution-failed: ${e.message}` }
    }
    throw e
  }
  const res = await a2aFetch(`${ep.endpoint}/session/${sessionId}/status`, {
    cache: 'no-store',
    headers: { 'Host': ep.hostHeader },
  })
  if (!res.ok) return { active: false, reason: `status-${res.status}` }
  return await res.json() as SessionStatus
}

function requireEnv(name: string): Address {
  const v = process.env[name]
  if (!v) throw new Error(`spec004/chain: ${name} not set`)
  return v as Address
}

// ─── Main entrypoint ─────────────────────────────────────────────────

export async function resolveSpec004Chain(
  input: ResolveChainInput,
): Promise<ResolveChainOk | ResolveChainError> {
  // 1. Current user must be an EOA-backed signer (demo). Passkey/OAuth
  //    users need a separate flow that signs the leaf delegation in the
  //    browser via WebAuthn — TODO below.
  let signerCtx
  try {
    signerCtx = await loadSignerForCurrentUser()
  } catch (e) {
    return {
      ok: false,
      error: 'no-eoa-signer',
      message: `loadSignerForCurrentUser failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
  if (signerCtx.kind !== 'eoa') {
    return {
      ok: false,
      error: 'no-eoa-signer',
      message:
        'Spec-004 chain minting currently requires an EOA-backed user. Passkey/OAuth flow is queued.',
    }
  }

  // 2. A2A session id + sessionKeyAddress.
  const sessionId = await getA2ASessionToken()
  if (!sessionId) {
    return {
      ok: false,
      error: 'no-a2a-session',
      message: 'No A2A session — connect your agent before voting/submitting',
    }
  }
  const status = await fetchSessionStatus(sessionId)
  if (!status.active || !status.sessionKeyAddress || !status.accountAddress) {
    // Most common cause: the cookie points at an a2a session that no longer
    // exists (fresh-start wiped state, a2a-agent restarted, or session
    // expired). The user-facing fix is to sign out + sign back in — the
    // demo-login/passkey/SIWE routes all re-bootstrap a fresh session.
    if (status.reason === 'status-404' || status.reason === 'session not found') {
      return {
        ok: false,
        error: 'session-status-failed',
        message: 'Your agent session expired or was reset. Sign out and sign back in to bootstrap a new session.',
      }
    }
    return {
      ok: false,
      error: 'session-status-failed',
      message: `session status: ${status.reason ?? 'unknown'}`,
    }
  }

  // 3. Look up the admin→holder delegation via person-mcp.
  let lookup
  try {
    lookup = await callMcp<{
      found: boolean
      credentialId?: string
      credentialType?: string
      adminDelegation?: Spec004SignedDelegation
      adminDelegationTarget?: string
    }>('person', 'ssi_get_marketplace_delegation', {
      principal: `person_${signerCtx.userRow.id}`,
      targetRegistry: input.targetRegistry,
      ...(input.credentialType ? { credentialType: input.credentialType } : {}),
    })
  } catch (e) {
    return {
      ok: false,
      error: 'no-marketplace-credential',
      message: `lookup failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
  if (!lookup.found || !lookup.adminDelegation) {
    return {
      ok: false,
      error: 'no-marketplace-credential',
      message:
        'No marketplace credential issued for this registry. Ask the pool/round admin to issue you a credential.',
    }
  }
  if (!lookup.credentialId) {
    return {
      ok: false,
      error: 'malformed-admin-delegation',
      message: 'admin delegation found but credentialId is missing',
    }
  }

  const adminDelegation = lookup.adminDelegation
  if (
    !adminDelegation.delegator ||
    !adminDelegation.delegate ||
    !adminDelegation.caveats ||
    !adminDelegation.signature
  ) {
    return {
      ok: false,
      error: 'malformed-admin-delegation',
      message: 'admin delegation is missing required fields',
    }
  }

  // 4. Mint the holder→session leaf. authority = hash(admin→holder).
  let dmAddress: Address
  try {
    dmAddress = requireEnv('DELEGATION_MANAGER_ADDRESS')
  } catch (e) {
    return { ok: false, error: 'env-missing', message: (e as Error).message }
  }
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.CHAIN_ID ?? '31337')

  const parentHash = delegationHash(
    {
      delegator: adminDelegation.delegator,
      delegate: adminDelegation.delegate,
      authority: adminDelegation.authority,
      caveats: adminDelegation.caveats.map((c) => ({
        enforcer: c.enforcer,
        terms: c.terms,
      })),
      salt: adminDelegation.salt,
    },
    chainId,
    dmAddress,
  )

  // Leaf caveats: short window (60s skew + 5 min) on top of the admin
  // delegation's already-long timestamp window. Keeping the leaf short
  // limits the blast radius if the session key leaks.
  const timestampEnforcer = process.env.TIMESTAMP_ENFORCER_ADDRESS as Address | undefined
  const allowedTargets = process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS as Address | undefined
  const allowedMethods = process.env.ALLOWED_METHODS_ENFORCER_ADDRESS as Address | undefined
  if (!timestampEnforcer || !allowedTargets || !allowedMethods) {
    return {
      ok: false,
      error: 'env-missing',
      message: 'TIMESTAMP_ENFORCER_ADDRESS / ALLOWED_TARGETS_ENFORCER_ADDRESS / ALLOWED_METHODS_ENFORCER_ADDRESS not set',
    }
  }
  // We re-bind the leaf to the same targets the admin allowed, plus
  // a short window. The on-chain enforcers run for both delegations so
  // the leaf can be more restrictive but not less.
  const adminTargets = adminDelegation.caveats
    .map((c) => c.enforcer.toLowerCase())
    .includes(allowedTargets.toLowerCase())
  void adminTargets

  const now = Math.floor(Date.now() / 1000)
  const leafCaveats = buildAdminDelegationCaveats({
    registryAddress: input.targetRegistry,
    methodSelectors: input.methodSelectors,
    validAfter: now - 60,
    validUntil: now + 5 * 60,
    enforcers: {
      allowedTargets,
      allowedMethods,
      timestamp: timestampEnforcer,
    },
  })

  const leafSalt = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))
  // The leaf's `delegator` MUST equal the admin delegation's `delegate`
  // (the cred holder) — that's what DelegationManager's chain walk checks
  // when validating index N+1's delegate equals index N's delegator. In
  // the legacy single-user path the session's accountAddress happened to
  // match the holder, but in the stranger-applies-to-round flow the
  // admin → holder delegation's delegator is the fund agent, not the
  // session principal. Reading the holder directly from the cred is the
  // robust source of truth.
  const leaf = await signChildDelegation({
    delegator: adminDelegation.delegate as Address,
    delegate: status.sessionKeyAddress as Address,
    parentHash: parentHash as Hex,
    caveats: leafCaveats,
    salt: leafSalt,
    chainId,
    delegationManagerAddress: dmAddress,
    signerPrivateKey: signerCtx.userRow.privateKey as Hex,
  })

  // Chain order matches DelegationManager: index 0 is the LEAF (delegate
  // = session key), tail is the ROOT (delegate = admin-rooted authority).
  return {
    ok: true,
    chain: [leaf, adminDelegation],
    targetRegistry: input.targetRegistry,
    credentialId: lookup.credentialId,
  }
}

// ─── TODO ─────────────────────────────────────────────────────────────
// Passkey/OAuth users: implement a `prepareSpec004Leaf({ … })` server
// helper that returns the EIP-712 hash to sign + the chain prefix; the
// browser collects a WebAuthn assertion against that hash; a follow-up
// server action assembles the chain. Until then, callers must surface
// the `no-eoa-signer` error to the user.
