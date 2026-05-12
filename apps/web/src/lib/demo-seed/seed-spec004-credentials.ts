/**
 * Spec 004 (b2) — demo-seed bootstrap for marketplace credentials.
 *
 * Issues `ProposalSubmitterCredential` to a given holder for a pool,
 * and / or `RoundVoterCredential` for a round, AND mints the matching
 * `admin → holder` on-chain delegation (signed by the admin's stored
 * EOA private key — demo-only). The signed delegation is persisted on
 * the holder's person-mcp credential_metadata row so the web action
 * layer can pick it up at vote/submit time.
 *
 * Idempotent — re-running for the same (admin, holder, registry) pair
 * is safe (the credential row is the dedupe key; if a recent one
 * exists, this helper exits without re-issuing).
 */

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { privateKeyToAccount } from 'viem/accounts'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { walletActionDomain, WalletActionTypes } from '@smart-agent/privacy-creds'
import { ssiConfig } from '@/lib/ssi/config'
import type { Address, Hex } from 'viem'
import {
  buildAdminDelegationCaveats,
  signRootDelegation,
  SPEC004_SELECTORS,
  type Spec004SignedDelegation,
} from '@smart-agent/sdk'
import { org, person } from '@/lib/ssi/clients'
import { provisionHolderWalletForDemoUser } from './provision-holder-wallet'
import { bootstrapA2ASessionForUser } from '@/lib/actions/a2a-session.action'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.CHAIN_ID ?? '31337')

interface SeedSpec004Input {
  /** Demo user id of the round/pool admin (whose smart account owns the
   *  pool/fund). Their privateKey is read from `web.users`. NOTE: in the
   *  catalyst demo seed, pool / fund agents are deployed with the
   *  DEPLOYER EOA as the smart-account owner — not a user. For that
   *  seed, pass `adminSigningKey: process.env.DEPLOYER_PRIVATE_KEY` so
   *  the `admin → holder` delegation is signed by the actual on-chain
   *  owner of the pool/fund. The `adminUserId` then becomes a label. */
  adminUserId: string
  /** Demo user id of the holder receiving the credential. */
  holderUserId: string
  /** Which kind to issue. */
  credentialType: 'ProposalSubmitterCredential' | 'RoundVoterCredential'
  /** Pool agent (treasury) address — required when issuing
   *  ProposalSubmitterCredential; matched by AnonCreds
   *  `expectedAttributes.poolAgentId` at submit time. */
  poolAgentId?: string
  /** Round subject (bytes32 hex) — required for RoundVoterCredential.
   *  Becomes the `roundSubject` attribute on the AnonCreds credential so
   *  the verifier can enforce cred ↔ round binding at action time.
   *  Pre-derived in the CLI wrapper via roundSubjectFor(roundIdSlug). */
  roundSubject?: string
  /** Optional override: the private key that should sign the
   *  `admin → holder` root delegation. Defaults to the admin user's
   *  stored privateKey. Pass the deployer key when seeding pools/funds
   *  that were deployed with the deployer EOA as owner (the current
   *  catalyst-seed pattern). The corresponding admin AgentAccount
   *  address must be derived from this key (or passed via
   *  `adminAccountOverride`). */
  adminSigningKey?: Hex
  /** Optional override: the AgentAccount address that becomes the
   *  `delegator` of the admin → holder delegation. Defaults to the
   *  admin user's `smartAccountAddress`. */
  adminAccountOverride?: Address
  /** Stateless self-issue: when set, bypass the holder users-table
   *  lookup. Use this for passkey/SIWE users (no `users` row). The
   *  helper provisions a holder wallet keyed on `holderPrincipalOverride`
   *  with `holderPrivateKeyOverride` as signer, then runs the standard
   *  AnonCreds dance using that key for all holder-side WalletActions. */
  holderPrivateKeyOverride?: Hex
  holderAccountOverride?: Address
  holderPrincipalOverride?: string
  /** Optional override: holder wallet context. Defaults to 'default'.
   *  Stateless self-issue uses 'spec004' to avoid colliding with the
   *  user's session-EOA wallet on the 'default' context. */
  holderWalletContextOverride?: string
}

export interface SeedSpec004Result {
  ok: boolean
  error?: string
  credentialId?: string
  adminDelegationHash?: Hex
}

function targetRegistryFor(credentialType: 'ProposalSubmitterCredential' | 'RoundVoterCredential'): Address {
  if (credentialType === 'ProposalSubmitterCredential') {
    const v = process.env.GRANT_PROPOSAL_REGISTRY_ADDRESS as Address | undefined
    if (!v) throw new Error('GRANT_PROPOSAL_REGISTRY_ADDRESS not set')
    return v
  }
  const v = process.env.VOTE_REGISTRY_ADDRESS as Address | undefined
  if (!v) throw new Error('VOTE_REGISTRY_ADDRESS not set')
  return v
}

function methodSelectorsFor(credentialType: 'ProposalSubmitterCredential' | 'RoundVoterCredential'): Hex[] {
  if (credentialType === 'ProposalSubmitterCredential') {
    return [
      SPEC004_SELECTORS.grantProposalSubmit,
      SPEC004_SELECTORS.grantProposalEdit,
      SPEC004_SELECTORS.grantProposalWithdraw,
    ]
  }
  return [SPEC004_SELECTORS.voteCast]
}

/** Spec 004 v2 — per-issuance nullifierSecret + cred-bound context.
 *  Each cred carries a 256-bit random `nullifierSecret` (issuer-generated;
 *  the holder receives it as part of the AnonCreds credential payload).
 *  The cred also binds the action context (`poolAgentId` for the
 *  submitter cred, `roundSubject` for the voter cred) so the verifier
 *  can enforce that the cred is targeted at the right place. */
function attributesFor(input: SeedSpec004Input, nullifierSecret: string): Record<string, string> {
  const year = String(new Date().getFullYear())
  if (input.credentialType === 'ProposalSubmitterCredential') {
    return {
      poolAgentId: input.poolAgentId ?? '',
      nullifierSecret,
      issuedYear: year,
    }
  }
  return {
    roundSubject: input.roundSubject ?? '',
    nullifierSecret,
    issuedYear: year,
  }
}

/**
 * Drive `org-mcp /credential/offer` → person-mcp `ssi_start_credential_exchange`
 * → `org-mcp /credential/issue` → person-mcp `ssi_finish_credential_exchange`,
 * with the admin→holder delegation passed through as `adminDelegationJson` +
 * `adminDelegationTarget` on the finish step.
 */
export async function seedSpec004Credential(input: SeedSpec004Input): Promise<SeedSpec004Result> {
  // ─── Lookups ──────────────────────────────────────────────────────
  // Stateless self-issue path skips users-table lookups.
  const stateless = !!input.holderPrivateKeyOverride && !!input.holderAccountOverride && !!input.holderPrincipalOverride
  const admin = stateless && input.adminSigningKey && input.adminAccountOverride
    ? null
    : db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.id, input.adminUserId)).get()
  if (!stateless && (!admin?.privateKey || !admin?.smartAccountAddress)) {
    return { ok: false, error: `admin ${input.adminUserId} missing privateKey/smartAccountAddress` }
  }
  const holder = stateless
    ? null
    : db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.id, input.holderUserId)).get()
  if (!stateless && (!holder?.privateKey || !holder?.smartAccountAddress)) {
    return { ok: false, error: `holder ${input.holderUserId} missing privateKey/smartAccountAddress` }
  }

  const targetRegistry = targetRegistryFor(input.credentialType)
  const methodSelectors = methodSelectorsFor(input.credentialType)

  // Resolve effective holder identity.
  const holderPrincipal = input.holderPrincipalOverride ?? `person_${holder!.id}`
  const holderPrivateKey = (input.holderPrivateKeyOverride ?? holder!.privateKey) as Hex
  const holderAccount = (input.holderAccountOverride ?? holder!.smartAccountAddress) as Address
  const holderWalletContext = input.holderWalletContextOverride ?? 'default'

  // Holder needs a provisioned SSI wallet to receive the credential.
  const provisionRes = await provisionHolderWalletForDemoUser({
    principal: holderPrincipal,
    privateKey: holderPrivateKey,
    walletContext: holderWalletContext,
  })
  if (!provisionRes.ok) {
    return { ok: false, error: `provision wallet: ${provisionRes.error}` }
  }
  const holderWalletId = provisionRes.holderWalletId
  if (!holderWalletId) return { ok: false, error: 'provision returned no holderWalletId' }

  // ─── 1. AnonCreds offer (org-mcp) ────────────────────────────────
  const offer = await org.offer(input.credentialType)
  const credentialOfferJson = offer.credentialOfferJson

  // ─── 2. Build + sign an AcceptCredentialOffer WalletAction ───────
  //         person-mcp's /tools/ endpoint unwraps the content[0].text
  //         envelope and returns the parsed JSON directly, so we use
  //         `person.callTool` rather than going through a2a's mcp-proxy.
  void bootstrapA2ASessionForUser
  let actionPayload: { action?: WalletAction & { expiresAt: string }; error?: string }
  try {
    actionPayload = await person.callTool<typeof actionPayload>('ssi_create_wallet_action', {
      principal: holderPrincipal,
      walletContext: holderWalletContext,
      type: 'AcceptCredentialOffer',
      counterpartyId: offer.issuerId,
      purpose: `accept ${input.credentialType}`,
      holderWalletId,
      credentialType: input.credentialType,
      schemaId: offer.schemaId,
      credDefId: offer.credDefId,
      issuerId: offer.issuerId,
    })
  } catch (e) {
    return { ok: false, error: `ssi_create_wallet_action threw: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (actionPayload.error || !actionPayload.action) {
    return { ok: false, error: actionPayload.error ?? 'no action returned' }
  }
  const action: WalletAction = { ...actionPayload.action, expiresAt: BigInt(actionPayload.action.expiresAt) }
  const holderEoa = privateKeyToAccount(holderPrivateKey)
  const acceptSignature = await holderEoa.signTypedData({
    domain: walletActionDomain(ssiConfig.chainId, ssiConfig.verifierContract),
    types: WalletActionTypes,
    primaryType: 'WalletAction',
    message: action,
  })

  // ─── 3. Holder builds the credential request via ssi-wallet-mcp ──
  let startParsed: { credentialRequestJson?: string; requestId?: string; error?: string }
  try {
    startParsed = await person.callTool<typeof startParsed>('ssi_start_credential_exchange', {
      action: actionPayload.action,
      signature: acceptSignature,
      credentialOfferJson,
      credDefId: offer.credDefId,
    })
  } catch (e) {
    return { ok: false, error: `ssi_start_credential_exchange threw: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (startParsed.error || !startParsed.credentialRequestJson) {
    return { ok: false, error: startParsed.error ?? 'no credentialRequestJson' }
  }

  // ─── 3. Pull `holderPseudoId` from the request so we can echo it as ──
  //       an attribute when org-mcp issues. AnonCreds derives the
  //       nullifier from this revealed attribute at verification time.
  // Spec 004 v2 — issuer generates a fresh 256-bit `nullifierSecret`
  // per issuance. The AnonCreds proof binds it to this credential's
  // issuer signature; the holder cannot fabricate or swap it. Per-cred
  // rotation eliminates cross-round / cross-pool linkability.
  const { randomBytes } = await import('node:crypto')
  const nullifierSecret = '0x' + randomBytes(32).toString('hex')
  const attributes = attributesFor(input, nullifierSecret)

  // ─── 4. org-mcp issues the credential ────────────────────────────
  //         /credential/issue defaults credentialType to OrgMembership;
  //         spec-004 needs the explicit type so the right credDef is
  //         loaded. Plain fetch — `org.issue` SDK helper doesn't surface
  //         the field yet.
  const issuedResp = await fetch(`${process.env.ORG_MCP_URL ?? 'http://localhost:3400'}/credential/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      credentialOfferJson,
      credentialRequestJson: startParsed.credentialRequestJson,
      attributes,
      credentialType: input.credentialType,
    }),
  })
  if (!issuedResp.ok) {
    return { ok: false, error: `/credential/issue ${issuedResp.status}: ${await issuedResp.text()}` }
  }
  const issued = await issuedResp.json() as { credentialJson: string }

  // ─── 5. Admin signs admin→holder delegation ──────────────────────
  const enforcers = {
    allowedTargets: process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS as Address,
    allowedMethods: process.env.ALLOWED_METHODS_ENFORCER_ADDRESS as Address,
    timestamp:      process.env.TIMESTAMP_ENFORCER_ADDRESS as Address,
  }
  if (!enforcers.allowedTargets || !enforcers.allowedMethods || !enforcers.timestamp) {
    return { ok: false, error: 'enforcer env not set (ALLOWED_TARGETS_ENFORCER_ADDRESS / ALLOWED_METHODS_ENFORCER_ADDRESS / TIMESTAMP_ENFORCER_ADDRESS)' }
  }
  const dmAddress = process.env.DELEGATION_MANAGER_ADDRESS as Address | undefined
  if (!dmAddress) return { ok: false, error: 'DELEGATION_MANAGER_ADDRESS not set' }

  // Determine effective admin signer + delegator account. For the catalyst
  // demo seed, pool / fund agents are deployed with the deployer EOA as
  // their AgentAccount owner — so the admin → holder delegation must be
  // signed by the deployer key, with the deployer's address as the delegator
  // (self-ownership of the pool's AgentAccount lets isOwner(delegator) pass
  // when DelegationManager dispatches; the deployer is the only registered
  // owner so it must be the delegator at the top of the chain).
  const adminSigningKey = (input.adminSigningKey ?? admin?.privateKey) as Hex
  if (!adminSigningKey) {
    return { ok: false, error: 'admin signing key required (set adminSigningKey or seed admin user with privateKey)' }
  }
  const adminAccount = (
    input.adminAccountOverride
      ?? (admin?.smartAccountAddress as Address | undefined)
      ?? (privateKeyToAccount(adminSigningKey).address as Address)
  )

  const caveats = buildAdminDelegationCaveats({
    registryAddress: targetRegistry,
    methodSelectors,
    enforcers,
  })
  const salt = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))
  let adminDelegation: Spec004SignedDelegation
  try {
    adminDelegation = await signRootDelegation({
      delegator: adminAccount,
      delegate: holderAccount,
      caveats,
      salt,
      chainId: CHAIN_ID,
      delegationManagerAddress: dmAddress,
      signerPrivateKey: adminSigningKey,
    })
  } catch (e) {
    return { ok: false, error: `signRootDelegation: ${e instanceof Error ? e.message : String(e)}` }
  }

  // ─── 6. Holder stores credential + admin delegation ──────────────
  let finishParsed: { credentialId?: string; error?: string }
  try {
    finishParsed = await person.callTool<typeof finishParsed>('ssi_finish_credential_exchange', {
      principal: holderPrincipal,
      holderWalletId,
      requestId: startParsed.requestId ?? '',
      credentialJson: issued.credentialJson,
      credentialType: input.credentialType,
      issuerId: offer.issuerId,
      schemaId: offer.schemaId,
      // Spec 004 (b2) — admin→holder delegation persists alongside the
      // AnonCred so the action layer can rebuild the chain at action time.
      adminDelegationJson: JSON.stringify(adminDelegation),
      adminDelegationTarget: targetRegistry.toLowerCase(),
    })
  } catch (e) {
    return { ok: false, error: `ssi_finish_credential_exchange threw: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (finishParsed.error || !finishParsed.credentialId) {
    return { ok: false, error: finishParsed.error ?? 'no credentialId' }
  }

  // Spec 004 backfill — the admin delegation should already be on the row
  // via the `ssi_finish_credential_exchange` → `/credentials/store` path,
  // but ABI/forwarding gaps have shown up in dev; an idempotent SQL
  // update guarantees the column is populated regardless of where the
  // tooling layer drops the field. Demo-only; production issuance
  // should rely on the HTTP path.
  try {
    const Database = (await import('better-sqlite3')).default
    const path = await import('node:path')
    const dbPath = path.resolve(process.cwd(), '..', 'person-mcp', 'person-mcp.db')
    const sqlite = new Database(dbPath)
    sqlite
      .prepare(
        `UPDATE credential_metadata
            SET admin_delegation_json = ?, admin_delegation_target = ?
          WHERE id = ?`,
      )
      .run(JSON.stringify(adminDelegation), targetRegistry.toLowerCase(), finishParsed.credentialId)
    sqlite.close()
  } catch (e) {
    console.warn(`[seed-spec004] SQL backfill of admin delegation failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  return {
    ok: true,
    credentialId: finishParsed.credentialId,
  }
}
