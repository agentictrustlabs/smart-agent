/**
 * Phase 4 end-to-end.
 *
 *   Maria (Privy) ─▶ person-mcp ─▶ ssi-wallet-mcp ─▶ Askar
 *                    │             │
 *                    ▼             ▼
 *                  audit        anoncreds
 *
 *   org-mcp (port 3400)      issues OrgMembershipCredential via HTTP
 *   family-mcp (port 3500)   issues GuardianOfMinorCredential via HTTP
 *                             also verifies guardian proofs via HTTP
 *
 * No in-process mocks. The wallet + verifier pull schemas/creddefs from the
 * shared registry (which has their issuer's signature from Phase 2) and
 * refuse tampered records.
 */

import { privateKeyToAccount } from 'viem/accounts'
import {
  walletActionDomain,
  WalletActionTypes,
  AnonCreds,
  type WalletAction,
} from '@smart-agent/privacy-creds'
import { anoncredsNodeJS } from '@hyperledger/anoncreds-nodejs'

AnonCreds.registerNativeBinding(anoncredsNodeJS)

const PERSON = process.env.PERSON_MCP_URL ?? 'http://127.0.0.1:3200'
const ORG    = process.env.ORG_MCP_URL    ?? 'http://127.0.0.1:3400'
const FAMILY = process.env.FAMILY_MCP_URL ?? 'http://127.0.0.1:3500'
const CHAIN_ID = Number(process.env.CHAIN_ID ?? '31337')
const VERIFIER = (process.env.SSI_ACTION_VERIFIER_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as `0x${string}`

const MARIA_PRIV = '0x' + 'a'.repeat(64) as `0x${string}`
const maria = privateKeyToAccount(MARIA_PRIV)
const PRINCIPAL = 'person_maria_phase4_demo'

async function callPerson<T>(name: string, args: unknown): Promise<T> {
  const res = await fetch(`${PERSON}/tools/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: name, args }),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`person-mcp ${name} ${res.status}: ${txt}`)
  return JSON.parse(txt) as T
}

async function callHttp<T>(base: string, path: string, body: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`${base}${path} ${res.status}: ${txt}`)
  return JSON.parse(txt) as T
}

async function signAction(actionLike: Record<string, unknown>): Promise<`0x${string}`> {
  const message = {
    ...actionLike,
    expiresAt: BigInt(actionLike.expiresAt as string | number | bigint),
  } as WalletAction
  return maria.signTypedData({
    domain: walletActionDomain(CHAIN_ID, VERIFIER),
    types: WalletActionTypes,
    primaryType: 'WalletAction',
    message,
  })
}

async function ensureProvisioned(): Promise<string> {
  const provA = await callPerson<{ action: WalletAction & { expiresAt: string } }>(
    'ssi_create_wallet_action',
    { principal: PRINCIPAL, type: 'ProvisionHolderWallet', counterpartyId: 'self', purpose: 'initial provision' },
  )
  const provSig = await signAction(provA.action as unknown as Record<string, unknown>)
  const provRes = await callPerson<{ holderWalletId: string }>(
    'ssi_provision_wallet',
    { action: provA.action, signature: provSig, expectedSigner: maria.address },
  )
  return provRes.holderWalletId
}

async function acceptViaIssuer(
  holderWalletId: string,
  issuerBase: string,
  credentialType: string,
  attributes: Record<string, string>,
): Promise<string /* credentialId */> {
  const offer = await callHttp<{
    credentialOfferJson: string; credDefId: string; schemaId: string; issuerId: string
  }>(issuerBase, '/credential/offer', { credentialType })

  const acceptA = await callPerson<{ action: WalletAction & { expiresAt: string } }>(
    'ssi_create_wallet_action',
    {
      principal: PRINCIPAL,
      type: 'AcceptCredentialOffer',
      counterpartyId: offer.issuerId,
      purpose: `accept ${credentialType}`,
      credentialType,
      holderWalletId,
    },
  )
  const acceptSig = await signAction(acceptA.action as unknown as Record<string, unknown>)
  const reqRes = await callPerson<{ requestId: string; credentialRequestJson: string }>(
    'ssi_start_credential_exchange',
    {
      action: acceptA.action,
      signature: acceptSig,
      credentialOfferJson: offer.credentialOfferJson,
      credDefId: offer.credDefId,
    },
  )

  const issuance = await callHttp<{ credentialJson: string }>(
    issuerBase,
    '/credential/issue',
    {
      credentialOfferJson: offer.credentialOfferJson,
      credentialRequestJson: reqRes.credentialRequestJson,
      attributes,
    },
  )

  const fin = await callPerson<{ credentialId: string }>(
    'ssi_finish_credential_exchange',
    {
      principal: PRINCIPAL,
      holderWalletId,
      requestId: reqRes.requestId,
      credentialJson: issuance.credentialJson,
      credentialType,
      issuerId: offer.issuerId,
      schemaId: offer.schemaId,
    },
  )
  return fin.credentialId
}

async function main() {
  console.log('=== Phase 4 end-to-end (real org-mcp + family-mcp) ===')
  console.log('Maria Privy EOA:', maria.address)

  // Who are we talking to?
  const orgCard    = await callHttp<{ did: string }>(ORG,    '/.well-known/agent.json', null, 'GET')
  const familyCard = await callHttp<{ did: string }>(FAMILY, '/.well-known/agent.json', null, 'GET')
  console.log('  org-mcp DID:   ', orgCard.did)
  console.log('  family-mcp DID:', familyCard.did)

  const holderWalletId = await ensureProvisioned()
  console.log('\n[A] holder wallet:', holderWalletId)

  // ── B1. Accept OrgMembership from org-mcp ──────────────────────────────
  console.log('\n[B1] accept OrgMembershipCredential from org-mcp')
  const membershipCredId = await acceptViaIssuer(holderWalletId, ORG, 'OrgMembershipCredential', {
    membershipStatus: 'active',
    role: 'member',
    joinedYear: '2024',
    circleId: 'circle_wellington',
  })
  console.log('  stored:', membershipCredId)

  // ── B2. Accept Guardian from family-mcp ────────────────────────────────
  console.log('\n[B2] accept GuardianOfMinorCredential from family-mcp')
  const guardianCredId = await acceptViaIssuer(holderWalletId, FAMILY, 'GuardianOfMinorCredential', {
    relationship: 'parent',
    minorBirthYear: '2015',
    issuedYear: '2026',
  })
  console.log('  stored:', guardianCredId)

  const listed = await callPerson<{ credentials: Array<{ credentialType: string }> }>(
    'ssi_list_my_credentials',
    { principal: PRINCIPAL },
  )
  const byType = listed.credentials.map(c => c.credentialType).join(', ')
  console.log(`\n  wallet now holds: ${byType}`)

  // ── C. Prove guardianship to family-mcp verifier ───────────────────────
  console.log('\n[C] present guardian proof to family-mcp /verify')
  const vreq = await callHttp<{ presentationRequest: Record<string, unknown> }>(
    FAMILY, '/verify/guardian/request', null, 'GET',
  )
  const presentA = await callPerson<{ action: WalletAction & { expiresAt: string } }>(
    'ssi_create_wallet_action',
    {
      principal: PRINCIPAL,
      type: 'CreatePresentation',
      counterpartyId: familyCard.did,
      purpose: 'prove_guardianship',
      credentialType: 'GuardianOfMinorCredential',
      holderWalletId,
      proofRequest: vreq.presentationRequest,
      allowedReveal: [],        // reveal nothing; predicate + pairwise only
      allowedPredicates: [{ attribute: 'minorBirthYear', operator: '>=', value: 2006 }],
      forbiddenAttrs: ['relationship', 'issuedYear'],
    },
  )
  // ssi_create_wallet_action already set proofRequestHash = hashProofRequest(proofRequest).
  // Sign once; the wallet will re-hash and compare.
  const presentSig = await signAction(presentA.action as unknown as Record<string, unknown>)

  const presentRes = await callPerson<{ presentation: string; auditSummary: { pairwiseHandle: string; holderBindingIncluded: boolean } }>(
    'ssi_create_presentation',
    {
      action: presentA.action,
      signature: presentSig,
      expectedSigner: maria.address,
      presentationRequest: vreq.presentationRequest,
      credentialSelections: [
        {
          credentialId: guardianCredId,
          revealReferents: ['attr_holder'],          // holder self-attested
          predicateReferents: ['pred_guardian'],
        },
      ],
    },
  )
  console.log('  presentation bytes:', presentRes.presentation.length)
  console.log('  pairwise:', presentRes.auditSummary.pairwiseHandle)
  console.log('  holderBindingIncluded:', presentRes.auditSummary.holderBindingIncluded)

  const verify = await callHttp<{ verified: boolean; reason?: string }>(
    FAMILY,
    '/verify/guardian/check',
    { presentation: presentRes.presentation, presentationRequest: vreq.presentationRequest },
  )
  console.log('\n[VERIFIER] family-mcp says verified:', verify.verified, verify.reason ?? '')

  if (!verify.verified) process.exit(1)
  console.log('\n✅ Phase 4 end-to-end OK')
  console.log('   two real issuers issued two different credential types to one holder')
  console.log('   proof presented to real verifier and accepted with ZK predicate only')

  // signaled for Phase 5/6 harnesses
  console.log('\n-- phase 4 handoff --')
  console.log('holderWalletId=' + holderWalletId)
  console.log('membershipCredId=' + membershipCredId)
  console.log('guardianCredId='   + guardianCredId)
}

main().catch((err) => { console.error('❌', err); process.exit(1) })
