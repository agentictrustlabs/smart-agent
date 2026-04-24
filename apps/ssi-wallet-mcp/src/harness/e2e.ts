/**
 * End-to-end Phase 1 test driver.
 *
 *   run:  pnpm --filter @smart-agent/ssi-wallet-mcp exec tsx src/harness/e2e.ts
 *
 * Requires ssi-wallet-mcp to be running on $SSI_WALLET_MCP_URL (default 3300).
 *
 * Acts out:
 *   Step A — Maria (cat-user-001) signs ProvisionHolderWallet (Privy) → wallet.
 *   Step B — Catalyst org offers membership cred → Maria signs AcceptOffer →
 *             wallet requests cred → org issues → wallet stores.
 *   Step C — Coach asks for presentation (role + joinedYear ≥ 2000) → Maria
 *             signs CreatePresentation → wallet builds proof → coach verifies.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { privateKeyToAccount } from 'viem/accounts'
import { walletActionDomain, WalletActionTypes, hashProofRequest, AnonCreds, type WalletAction } from '@smart-agent/privacy-creds'
import { anoncredsNodeJS } from '@hyperledger/anoncreds-nodejs'
import { mockOrgIssuer, MEMBERSHIP_SCHEMA_ID, MEMBERSHIP_CRED_DEF_ID, CATALYST_ISSUER_ID } from '../registry/mock-org-issuer.js'
import { buildCoachPresentationRequest, COACH_VERIFIER_ID, verifyCoachPresentation } from '../registry/mock-coach-verifier.js'

// Harness calls AnonCreds crypto directly (through the mock issuer); register binding first.
AnonCreds.registerNativeBinding(anoncredsNodeJS)

const WALLET = process.env.SSI_WALLET_MCP_URL ?? 'http://127.0.0.1:3300'
const REGISTRY_PATH = process.env.CREDENTIAL_REGISTRY_PATH ?? './credential-registry.db'
const CHAIN_ID = Number(process.env.CHAIN_ID ?? '31337')
const VERIFIER = (process.env.SSI_ACTION_VERIFIER_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as `0x${string}`

// ─── Pretend-Privy EOA (Maria) — in real flow this is her Privy wallet. ─────
const MARIA_PRIV = '0x' + 'a'.repeat(64) as `0x${string}`
const maria = privateKeyToAccount(MARIA_PRIV)
const PERSON = 'person_maria_catalyst_001'

function nonce(): `0x${string}` {
  return ('0x' + randomBytes(32).toString('hex')) as `0x${string}`
}
function expiresIn(sec = 120): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + sec)
}

async function signAction(action: WalletAction): Promise<`0x${string}`> {
  return maria.signTypedData({
    domain: walletActionDomain(CHAIN_ID, VERIFIER),
    types: WalletActionTypes,
    primaryType: 'WalletAction',
    message: action,
  })
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${WALLET}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body, (_, v) => typeof v === 'bigint' ? v.toString() : v),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`${path} ${res.status}: ${txt}`)
  return JSON.parse(txt) as T
}

async function main() {
  console.log('=== Phase 1 end-to-end ===')
  console.log('Maria Privy EOA:', maria.address)

  // ── Step A ──────────────────────────────────────────────────────────────
  console.log('\n[A] Provision holder wallet')
  const provisionAction: WalletAction = {
    type: 'ProvisionHolderWallet',
    actionId: `wa_${randomUUID()}`,
    personPrincipal: PERSON,
    holderWalletId: 'pending',
    counterpartyId: 'self',
    purpose: 'initial provision',
    credentialType: '',
    proofRequestHash: ('0x' + '0'.repeat(64)) as `0x${string}`,
    allowedReveal: '[]',
    allowedPredicates: '[]',
    forbiddenAttrs: '[]',
    nonce: nonce(),
    expiresAt: expiresIn(),
  }
  const provSig = await signAction(provisionAction)
  const provRes = await post<{ holderWalletId: string; linkSecretId: string }>(
    '/wallet/provision',
    { action: provisionAction, signature: provSig, expectedSigner: maria.address },
  )
  console.log('  →', provRes)
  const holderWalletId = provRes.holderWalletId

  // ── Step B ──────────────────────────────────────────────────────────────
  console.log('\n[B] Accept OrgMembership credential')
  const issuer = mockOrgIssuer(REGISTRY_PATH)
  await issuer.ensureSchemaAndCredDef()
  const offerJson = issuer.createOffer()

  const acceptAction: WalletAction = {
    type: 'AcceptCredentialOffer',
    actionId: `wa_${randomUUID()}`,
    personPrincipal: PERSON,
    holderWalletId,
    counterpartyId: CATALYST_ISSUER_ID,
    purpose: 'join catalyst network',
    credentialType: 'OrgMembershipCredential',
    proofRequestHash: ('0x' + '0'.repeat(64)) as `0x${string}`,
    allowedReveal: '[]',
    allowedPredicates: '[]',
    forbiddenAttrs: '[]',
    nonce: nonce(),
    expiresAt: expiresIn(),
  }
  const acceptSig = await signAction(acceptAction)
  const requestRes = await post<{ requestId: string; credentialRequestJson: string }>(
    '/credentials/request',
    { action: acceptAction, signature: acceptSig, credentialOfferJson: offerJson, credDefId: MEMBERSHIP_CRED_DEF_ID },
  )
  console.log('  requestId:', requestRes.requestId)

  const credJson = issuer.issue(offerJson, requestRes.credentialRequestJson, {
    membershipStatus: 'active',
    role: 'member',
    joinedYear: '2025',
    circleId: 'circle_wellington',
  })
  const storeRes = await post<{ credentialId: string }>(
    '/credentials/store',
    {
      holderWalletId,
      requestId: requestRes.requestId,
      credentialJson: credJson,
      credentialType: 'OrgMembershipCredential',
      issuerId: CATALYST_ISSUER_ID,
      schemaId: MEMBERSHIP_SCHEMA_ID,
    },
  )
  console.log('  stored:', storeRes)

  // ── Step C ──────────────────────────────────────────────────────────────
  console.log('\n[C] Present to coach')
  const pr = buildCoachPresentationRequest()
  const presentAction: WalletAction = {
    type: 'CreatePresentation',
    actionId: `wa_${randomUUID()}`,
    personPrincipal: PERSON,
    holderWalletId,
    counterpartyId: COACH_VERIFIER_ID,
    purpose: 'coach_onboarding',
    credentialType: 'OrgMembershipCredential',
    proofRequestHash: hashProofRequest(pr),
    allowedReveal: JSON.stringify(['role']),
    allowedPredicates: JSON.stringify([{ attribute: 'joinedYear', operator: '>=', value: 2000 }]),
    forbiddenAttrs: JSON.stringify(['circleId']),
    nonce: nonce(),
    expiresAt: expiresIn(),
  }
  const presentSig = await signAction(presentAction)
  const presentRes = await post<{ presentation: string; auditSummary: unknown }>(
    '/proofs/present',
    {
      action: presentAction,
      signature: presentSig,
      presentationRequest: pr,
      credentialSelections: [
        { credentialId: storeRes.credentialId, revealReferents: ['attr_role'], predicateReferents: ['pred_active'] },
      ],
    },
  )
  console.log('  presentation bytes:', presentRes.presentation.length)
  console.log('  audit:', presentRes.auditSummary)

  const verified = verifyCoachPresentation(REGISTRY_PATH, presentRes.presentation, pr)
  console.log('\n[VERIFIER] presentation verifies:', verified)

  if (!verified) process.exit(1)
  console.log('\n✅ Phase 1 end-to-end OK')
}

main().catch((err) => { console.error('❌', err); process.exit(1) })
