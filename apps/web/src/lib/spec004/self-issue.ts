/**
 * Spec 004 (b2) — Self-issue admin→holder marketplace delegation.
 *
 * For stateless-auth users (passkey/SIWE) acting as the pool/round admin
 * for their *own* pool/round, the normal cred-issuance flow doesn't fit:
 * there's no `users.privateKey` to sign the admin delegation, and the
 * pool admin is also the only intended pledger/voter — so the AnonCreds
 * presentation step is overkill.
 *
 * This helper bypasses the AnonCreds dance and writes a minimal
 * `credential_metadata` row carrying just the admin→holder delegation,
 * deployer-signed (the deployer is an initial owner of every freshly
 * deployed AgentAccount, so ERC-1271 accepts the signature).
 *
 *   - delegator: poolAdmin (the user's smart account)
 *   - delegate:  the same smart account (admin acting as their own holder)
 *   - authority: ROOT_AUTHORITY
 *   - caveats:   AllowedTargets(registry) + AllowedMethods(selectors) +
 *                Timestamp(now-60s, now+30d)
 *   - signature: deployer EOA, validated via AgentAccount.isValidSignature
 *
 * The row is inserted directly into person-mcp's SQLite at
 * `apps/person-mcp/person-mcp.db` (matching the existing dev-mode
 * pattern in seed-spec004-credentials.ts). Production would replace
 * this with a real MCP tool call.
 */

import 'server-only'
import path from 'node:path'
import type { Address, Hex } from 'viem'
import {
  buildAdminDelegationCaveats,
  signRootDelegation,
  SPEC004_SELECTORS,
} from '@smart-agent/sdk'

interface SelfIssueInput {
  /** The pool/round admin's smart account (also the holder for self-issue). */
  smartAccount: Address
  /** Target registry the delegation gates. */
  targetRegistry: Address
  /** Method selectors the delegation allows. */
  methodSelectors: Hex[]
  /** Informational. Pledger creds aren't AnonCred-gated; use a marker. */
  credentialType?: string
}

export async function selfIssueMarketplaceDelegation(
  input: SelfIssueInput,
): Promise<{ ok: true; credentialId: string } | { ok: false; error: string }> {
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined
  if (!deployerKey) return { ok: false, error: 'DEPLOYER_PRIVATE_KEY not set' }
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.CHAIN_ID ?? '31337')
  const delegationManager = process.env.DELEGATION_MANAGER_ADDRESS as Address | undefined
  const allowedTargets = process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS as Address | undefined
  const allowedMethods = process.env.ALLOWED_METHODS_ENFORCER_ADDRESS as Address | undefined
  const timestamp = process.env.TIMESTAMP_ENFORCER_ADDRESS as Address | undefined
  if (!delegationManager || !allowedTargets || !allowedMethods || !timestamp) {
    return {
      ok: false,
      error:
        'DELEGATION_MANAGER / ALLOWED_TARGETS / ALLOWED_METHODS / TIMESTAMP enforcer addresses not all set',
    }
  }

  const principal = `person_${input.smartAccount.toLowerCase()}`

  // 1. Resolve the holder wallet. /wallet/provision requires a signed
  //    WalletAction which we can't mint here; instead we rely on the
  //    onboarding flow (HubOnboardClient → provisionHolderWalletViaSession)
  //    to have already created the holder wallet for this principal.
  const walletUrl = process.env.SSI_WALLET_URL ?? process.env.PERSON_MCP_URL ?? 'http://localhost:3500'
  const walletContext = 'default'
  let holderWalletId: string
  try {
    const lookup = await fetch(
      `${walletUrl}/wallet/${encodeURIComponent(principal)}/${encodeURIComponent(walletContext)}`,
      { cache: 'no-store' },
    )
    if (!lookup.ok) {
      return {
        ok: false,
        error: `holder wallet not provisioned for ${principal} — onboarding flow should have created it`,
      }
    }
    const j = (await lookup.json()) as { holderWalletId?: string }
    if (!j.holderWalletId) {
      return { ok: false, error: 'wallet lookup ok but no holderWalletId' }
    }
    holderWalletId = j.holderWalletId
  } catch (e) {
    return { ok: false, error: `wallet lookup threw: ${e instanceof Error ? e.message : String(e)}` }
  }

  // 2. Build + sign the admin→holder delegation. Caveat scope =
  //    [target registry, allowed selectors, 30-day timestamp window].
  const caveats = buildAdminDelegationCaveats({
    registryAddress: input.targetRegistry,
    methodSelectors: input.methodSelectors,
    validAfter: Math.floor(Date.now() / 1000) - 60,
    validUntil: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    enforcers: { allowedTargets, allowedMethods, timestamp },
  })
  const salt = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))
  let adminDelegation
  try {
    adminDelegation = await signRootDelegation({
      delegator: input.smartAccount,
      delegate: input.smartAccount, // admin acts as their own holder for self-issue
      caveats,
      salt,
      chainId,
      delegationManagerAddress: delegationManager,
      signerPrivateKey: deployerKey,
    })
  } catch (e) {
    return { ok: false, error: `signRootDelegation: ${e instanceof Error ? e.message : String(e)}` }
  }

  // 3. Insert a credential_metadata row directly. Dev-mode SQLite write —
  //    matches the established pattern in seed-spec004-credentials.ts.
  try {
    const Database = (await import('better-sqlite3')).default
    const dbPath = path.resolve(process.cwd(), '..', 'person-mcp', 'person-mcp.db')
    const sqlite = new Database(dbPath)
    try {
      const credId = `cred_self_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const credType = input.credentialType ?? 'PledgerCredential'
      sqlite
        .prepare(
          `INSERT INTO credential_metadata
             (id, holder_wallet_id, issuer_id, schema_id, cred_def_id, credential_type,
              received_at, status, link_secret_id, target_org_address,
              admin_delegation_json, admin_delegation_target)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          credId,
          holderWalletId,
          `urn:smart-agent:self-issue:${input.smartAccount.toLowerCase()}`,
          'urn:smart-agent:self-issue:no-schema',
          'urn:smart-agent:self-issue:no-cred-def',
          credType,
          new Date().toISOString(),
          'active',
          'self-issue-no-link-secret',
          null,
          JSON.stringify(adminDelegation),
          input.targetRegistry.toLowerCase(),
        )
      return { ok: true, credentialId: credId }
    } finally {
      sqlite.close()
    }
  } catch (e) {
    return { ok: false, error: `sqlite insert: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** Convenience wrapper for the pool-pledge case. */
export async function selfIssuePledgerDelegation(args: {
  smartAccount: Address
  pledgeRegistry: Address
}) {
  return selfIssueMarketplaceDelegation({
    smartAccount: args.smartAccount,
    targetRegistry: args.pledgeRegistry,
    methodSelectors: [SPEC004_SELECTORS.pledgeSubmit],
    credentialType: 'PledgerCredential',
  })
}

/**
 * Issue a full AnonCreds marketplace credential (RoundVoterCredential or
 * ProposalSubmitterCredential). Two callers:
 *
 *   - Self-issue: admin == holder (round/pool creator acting as their own
 *     submitter/voter). The convenience wrapper `selfIssueMarketplaceCredential`
 *     handles this case.
 *   - Admin-issue: round/pool admin grants a separate holder permission
 *     (e.g. adding a voter to a round). The web action that wraps this
 *     gate-checks that the caller is in fact the round operator.
 *
 * Both paths use the deployer EOA to sign on behalf of both the admin and
 * holder AgentAccounts (the deployer is an initial owner of every freshly
 * deployed AgentAccount, so ERC-1271 accepts the signature). The holder's
 * person-mcp wallet is provisioned at `walletContext='spec004'` so it
 * doesn't collide with the session-EOA wallet on `'default'`.
 *
 * Idempotent at the cred-row level — calling twice issues two creds. The
 * action layer's retry-once pattern (issue → re-resolve chain) accepts
 * either as long as one is found.
 */
export async function issueMarketplaceCredential(args: {
  /** The round/pool admin AgentAccount (delegator of the root delegation). */
  adminSmartAccount: Address
  /** The holder AgentAccount (delegate of the root delegation; the user
   *  whose person-mcp will store the credential). */
  holderSmartAccount: Address
  credentialType: 'RoundVoterCredential' | 'ProposalSubmitterCredential'
  /** Required for ProposalSubmitterCredential — binds the cred to a pool. */
  poolAgentId?: string
  /** Required for RoundVoterCredential — binds the cred to a round. */
  roundSubject?: string
  /** Override the holder's person-mcp principal. Demo/google users have
   *  `person_<users.id>`; passkey/SIWE users have `person_<smartAccount>`.
   *  The caller resolves which form applies (e.g. by checking the users
   *  table for a smartAccountAddress match). Default = stateless form. */
  holderPrincipalOverride?: string
  /** Override the holder's signer privateKey + wallet context. For demo
   *  users with a stored EOA, pass their privateKey + walletContext='default'
   *  so we route the issuance into their existing person-mcp wallet (the
   *  wallet's `signer_eoa` matches what `loadSignerForCurrentUser` will
   *  return at presentation time). Stateless users keep the default
   *  deployer-signed 'spec004' wallet. */
  holderPrivateKeyOverride?: `0x${string}`
  holderWalletContextOverride?: string
}): Promise<{ ok: true; credentialId: string } | { ok: false; error: string }> {
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined
  if (!deployerKey) return { ok: false, error: 'DEPLOYER_PRIVATE_KEY not set' }

  const principal = args.holderPrincipalOverride
    ?? `person_${args.holderSmartAccount.toLowerCase()}`
  const holderPrivateKey = args.holderPrivateKeyOverride ?? deployerKey
  const holderWalletContext = args.holderWalletContextOverride ?? 'spec004'
  try {
    const { seedSpec004Credential } = await import('@/lib/demo-seed/seed-spec004-credentials')
    const result = await seedSpec004Credential({
      adminUserId: 'issue',
      holderUserId: 'issue',
      credentialType: args.credentialType,
      poolAgentId: args.poolAgentId,
      roundSubject: args.roundSubject,
      adminSigningKey: deployerKey,
      adminAccountOverride: args.adminSmartAccount,
      holderPrivateKeyOverride: holderPrivateKey,
      holderAccountOverride: args.holderSmartAccount,
      holderPrincipalOverride: principal,
      holderWalletContextOverride: holderWalletContext,
    })
    if (!result.ok) return { ok: false, error: result.error ?? 'seedSpec004Credential failed' }
    return { ok: true, credentialId: result.credentialId ?? '' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Self-issue wrapper: admin == holder. Used by the existing
 *  retry-on-action-failure auto-issue path. */
export async function selfIssueMarketplaceCredential(args: {
  smartAccount: Address
  credentialType: 'RoundVoterCredential' | 'ProposalSubmitterCredential'
  poolAgentId?: string
  roundSubject?: string
}) {
  return issueMarketplaceCredential({
    adminSmartAccount: args.smartAccount,
    holderSmartAccount: args.smartAccount,
    credentialType: args.credentialType,
    poolAgentId: args.poolAgentId,
    roundSubject: args.roundSubject,
  })
}
