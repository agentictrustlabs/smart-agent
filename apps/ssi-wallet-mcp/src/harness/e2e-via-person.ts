/**
 * Phase 3 end-to-end through person-mcp as the consent gateway.
 *
 *   harness (Privy key) ──▶  person-mcp  ──▶  ssi-wallet-mcp
 *                              │                      │
 *                              │ audit rows           │ vault + anoncreds
 *                              ▼                      ▼
 *                         person-mcp.db        ssi-wallet.db + vault
 *
 * Requires:
 *   - ssi-wallet-mcp running on SSI_WALLET_MCP_URL (default 3300)
 *   - person-mcp running on PERSON_MCP_URL (default 3200)
 *
 * Differences from e2e.ts:
 *   - Unsigned WalletActions come from person-mcp (`ssi_create_wallet_action`).
 *   - Privy-signed actions are posted back to person-mcp tools, never directly
 *     to ssi-wallet-mcp.
 *   - Proof audit row lands in person-mcp's ssi_proof_audit.
 */

import { privateKeyToAccount } from 'viem/accounts'
import { walletActionDomain, WalletActionTypes, AnonCreds, type WalletAction } from '@smart-agent/privacy-creds'
import { anoncredsNodeJS } from '@hyperledger/anoncreds-nodejs'
import {
  mockOrgIssuer,
  MEMBERSHIP_SCHEMA_ID,
  MEMBERSHIP_CRED_DEF_ID,
  CATALYST_ISSUER_ID,
} from '../registry/mock-org-issuer.js'
import { buildCoachPresentationRequest, COACH_VERIFIER_ID, verifyCoachPresentation } from '../registry/mock-coach-verifier.js'

AnonCreds.registerNativeBinding(anoncredsNodeJS)

const PERSON = process.env.PERSON_MCP_URL ?? 'http://127.0.0.1:3200'
const REGISTRY_PATH = process.env.CREDENTIAL_REGISTRY_PATH ?? '/home/barb/smart-agent/apps/ssi-wallet-mcp/credential-registry.db'
const CHAIN_ID = Number(process.env.CHAIN_ID ?? '31337')
const VERIFIER = (process.env.SSI_ACTION_VERIFIER_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as `0x${string}`

const MARIA_PRIV = '0x' + 'a'.repeat(64) as `0x${string}`
const maria = privateKeyToAccount(MARIA_PRIV)
const PRINCIPAL = 'person_maria_catalyst_001'

async function callTool<T>(name: string, args: unknown): Promise<T> {
  const res = await fetch(`${PERSON}/tools/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: name, args }),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`person-mcp ${name} ${res.status}: ${txt}`)
  return JSON.parse(txt) as T
}

async function signAction(actionLike: Record<string, unknown>): Promise<`0x${string}`> {
  const message = { ...actionLike, expiresAt: BigInt(actionLike.expiresAt as string | number | bigint) } as WalletAction
  return maria.signTypedData({
    domain: walletActionDomain(CHAIN_ID, VERIFIER),
    types: WalletActionTypes,
    primaryType: 'WalletAction',
    message,
  })
}

async function main() {
  console.log('=== Phase 3 end-to-end via person-mcp ===')
  console.log('Maria Privy EOA:', maria.address)

  // ── A. Provision (through person-mcp) ───────────────────────────────────
  console.log('\n[A] ssi_create_wallet_action (Provision) → Privy-sign → ssi_provision_wallet')
  const provA = await callTool<{ action: WalletAction & { expiresAt: string } }>(
    'ssi_create_wallet_action',
    {
      principal: PRINCIPAL,
      type: 'ProvisionHolderWallet',
      counterpartyId: 'self',
      purpose: 'initial provision',
    },
  )
  const provSig = await signAction(provA.action as unknown as Record<string, unknown>)
  const provRes = await callTool<{ holderWalletId: string; linkSecretId: string }>(
    'ssi_provision_wallet',
    { action: provA.action, signature: provSig, expectedSigner: maria.address },
  )
  console.log('  →', provRes)
  const holderWalletId = provRes.holderWalletId

  // ── B. Accept credential (through person-mcp) ──────────────────────────
  console.log('\n[B] ssi_start_credential_exchange → issue → ssi_finish_credential_exchange')
  const issuer = mockOrgIssuer(REGISTRY_PATH)
  await issuer.ensureSchemaAndCredDef()
  const offerJson = issuer.createOffer()

  const acceptA = await callTool<{ action: WalletAction & { expiresAt: string } }>(
    'ssi_create_wallet_action',
    {
      principal: PRINCIPAL,
      type: 'AcceptCredentialOffer',
      counterpartyId: CATALYST_ISSUER_ID,
      purpose: 'join catalyst network',
      credentialType: 'OrgMembershipCredential',
      holderWalletId,
    },
  )
  const acceptSig = await signAction(acceptA.action as unknown as Record<string, unknown>)
  const requestRes = await callTool<{ requestId: string; credentialRequestJson: string }>(
    'ssi_start_credential_exchange',
    {
      action: acceptA.action,
      signature: acceptSig,
      credentialOfferJson: offerJson,
      credDefId: MEMBERSHIP_CRED_DEF_ID,
    },
  )
  console.log('  requestId:', requestRes.requestId)

  const credJson = issuer.issue(offerJson, requestRes.credentialRequestJson, {
    membershipStatus: 'active',
    role: 'leader',
    joinedYear: '2024',
    circleId: 'circle_wellington',
  })
  const finishRes = await callTool<{ credentialId: string }>(
    'ssi_finish_credential_exchange',
    {
      principal: PRINCIPAL,
      holderWalletId,
      requestId: requestRes.requestId,
      credentialJson: credJson,
      credentialType: 'OrgMembershipCredential',
      issuerId: CATALYST_ISSUER_ID,
      schemaId: MEMBERSHIP_SCHEMA_ID,
    },
  )
  console.log('  stored:', finishRes)

  // Verify metadata surfaced to person-mcp
  const listed = await callTool<{ credentials: Array<{ id: string }> }>(
    'ssi_list_my_credentials',
    { principal: PRINCIPAL },
  )
  console.log('  list_my_credentials:', listed.credentials.length, 'cred(s)')

  // ── C. Present to coach (through person-mcp) ───────────────────────────
  console.log('\n[C] ssi_create_wallet_action (CreatePresentation) → Privy-sign → ssi_create_presentation')
  const pr = buildCoachPresentationRequest()
  const presentA = await callTool<{ action: WalletAction & { expiresAt: string } }>(
    'ssi_create_wallet_action',
    {
      principal: PRINCIPAL,
      type: 'CreatePresentation',
      counterpartyId: COACH_VERIFIER_ID,
      purpose: 'coach_onboarding',
      credentialType: 'OrgMembershipCredential',
      holderWalletId,
      proofRequest: pr,
      allowedReveal: ['role'],
      allowedPredicates: [{ attribute: 'joinedYear', operator: '>=', value: 2000 }],
      forbiddenAttrs: ['circleId'],
    },
  )
  const presentSig = await signAction(presentA.action as unknown as Record<string, unknown>)
  const presentRes = await callTool<{ presentation: string; auditSummary: { pairwiseHandle: string } }>(
    'ssi_create_presentation',
    {
      action: presentA.action,
      signature: presentSig,
      expectedSigner: maria.address,
      presentationRequest: pr,
      credentialSelections: [
        { credentialId: finishRes.credentialId, revealReferents: ['attr_role'], predicateReferents: ['pred_active'] },
      ],
    },
  )
  console.log('  presentation bytes:', presentRes.presentation.length)
  console.log('  pairwiseHandle:', presentRes.auditSummary.pairwiseHandle)

  const verified = verifyCoachPresentation(REGISTRY_PATH, presentRes.presentation, pr)
  console.log('\n[VERIFIER] presentation verifies:', verified)

  const audit = await callTool<{ audit: Array<{ result: string; verifierId: string; revealedAttrs: string; pairwiseHandle: string }> }>(
    'ssi_list_proof_audit',
    { principal: PRINCIPAL },
  )
  console.log('\n[AUDIT via person-mcp]', audit.audit.length, 'row(s):')
  for (const r of audit.audit.slice(0, 3)) {
    console.log(`  result=${r.result} verifier=${r.verifierId}`)
    console.log(`  revealed=${r.revealedAttrs}  pairwise=${r.pairwiseHandle}`)
  }

  if (!verified) process.exit(1)
  console.log('\n✅ Phase 3 via person-mcp OK')
}

main().catch((err) => { console.error('❌', err); process.exit(1) })
