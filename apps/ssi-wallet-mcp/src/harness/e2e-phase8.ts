/**
 * Phase 8 end-to-end — cheqd-style verifier.
 *
 *   Success criterion: a verifier configured with ONLY an RPC URL and the
 *   CredentialRegistry contract address (no issuer DB, no off-chain registry
 *   path, no issuer signature) verifies a guardian proof from Maria.
 *
 *   Flow:
 *     1. org-mcp + family-mcp have already published schemas and credDefs
 *        on-chain (via boot-seed or by visiting /admin/issue).
 *     2. Maria accepts a GuardianOfMinor credential into "personal".
 *     3. family-mcp's /verify/guardian/request returns a signed request.
 *     4. Wallet builds a presentation.
 *     5. The "outside" verifier in this script creates a fresh OnChainResolver
 *        pointing at the contract address (no DB access), resolves the
 *        schema + credDef from event logs, and calls AnonCreds.verifierVerifyPresentation.
 *
 *   Env:
 *     RPC_URL                                   http://127.0.0.1:8545
 *     CREDENTIAL_REGISTRY_CONTRACT_ADDRESS      0x...
 *     ORG_MCP_URL / FAMILY_MCP_URL / SSI_WALLET_MCP_URL / PERSON_MCP_URL
 */

import { privateKeyToAccount } from 'viem/accounts'
import {
  walletActionDomain,
  WalletActionTypes,
  AnonCreds,
  type WalletAction,
} from '@smart-agent/privacy-creds'
import { anoncredsNodeJS } from '@hyperledger/anoncreds-nodejs'
import {
  OnChainResolver,
  loadVerifiedSchema,
  loadVerifiedCredDef,
} from '@smart-agent/credential-registry'

AnonCreds.registerNativeBinding(anoncredsNodeJS)

const WALLET = process.env.SSI_WALLET_MCP_URL ?? 'http://127.0.0.1:3300'
const FAMILY = process.env.FAMILY_MCP_URL    ?? 'http://127.0.0.1:3500'
const PERSON = process.env.PERSON_MCP_URL    ?? 'http://127.0.0.1:3200'
const CHAIN_ID = Number(process.env.CHAIN_ID ?? '31337')
const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const REGISTRY = process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS as `0x${string}` | undefined
const VERIFIER = (process.env.SSI_ACTION_VERIFIER_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`

if (!REGISTRY) {
  console.error('CREDENTIAL_REGISTRY_CONTRACT_ADDRESS env is required')
  process.exit(1)
}

const MARIA_KEY = ('0x' + 'a'.repeat(64)) as `0x${string}`
const maria = privateKeyToAccount(MARIA_KEY)
const PRINCIPAL = 'person_cat-user-001-maria-phase8'

let passed = 0
let failed = 0
function pass(name: string) { passed++; console.log('✅', name) }
function fail(name: string, err?: unknown) { failed++; console.error('❌', name, err ?? '') }

async function http<T>(base: string, path: string, opts: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: T | null; raw: string }> {
  const r = await fetch(`${base}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json' },
    body: opts.body === undefined
      ? undefined
      : JSON.stringify(opts.body, (_, v) => typeof v === 'bigint' ? v.toString() : v),
  })
  const raw = await r.text()
  let body: T | null = null
  try { body = raw ? JSON.parse(raw) as T : null } catch { body = null }
  return { status: r.status, body, raw }
}

async function personTool<T>(name: string, args: unknown): Promise<T> {
  const r = await http<T>(PERSON, `/tools/${name}`, { body: { tool: name, args } })
  if (r.status !== 200) throw new Error(`person.${name} ${r.status}: ${r.raw}`)
  return r.body as T
}

async function signAction(action: WalletAction) {
  return maria.signTypedData({
    domain: walletActionDomain(CHAIN_ID, VERIFIER),
    types: WalletActionTypes,
    primaryType: 'WalletAction',
    message: action,
  })
}

async function buildAndSign(principal: string, context: string, type: string, extra: Record<string, unknown> = {}) {
  const built = await personTool<{ action: WalletAction & { expiresAt: string } }>(
    'ssi_create_wallet_action',
    { principal, walletContext: context, type, ...extra },
  )
  const action: WalletAction = { ...built.action, expiresAt: BigInt(built.action.expiresAt) }
  const signature = await signAction(action)
  return { built, action, signature }
}

async function provision(context: string): Promise<string> {
  const { built, signature } = await buildAndSign(PRINCIPAL, context, 'ProvisionHolderWallet', {
    counterpartyId: 'self', purpose: `provision ${context}`,
  })
  const r = await http<{ holderWalletId: string }>(WALLET, '/wallet/provision', {
    body: { action: built.action, signature, expectedSigner: maria.address },
  })
  if (r.status !== 200) throw new Error(`provision ${context} ${r.status}: ${r.raw}`)
  return r.body!.holderWalletId
}

async function acceptGuardian(context: string, holderWalletId: string): Promise<{ credentialId: string; schemaId: string; credDefId: string; issuerId: string }> {
  const offerR = await http<{ credentialOfferJson: string; credDefId: string; schemaId: string; issuerId: string }>(
    FAMILY, '/credential/offer', { body: { credentialType: 'GuardianOfMinorCredential' } },
  )
  if (offerR.status !== 200) throw new Error(`offer ${offerR.status}: ${offerR.raw}`)
  const offer = offerR.body!
  const { built, signature } = await buildAndSign(PRINCIPAL, context, 'AcceptCredentialOffer', {
    counterpartyId: offer.issuerId, credentialType: 'GuardianOfMinorCredential', holderWalletId,
  })
  const reqR = await http<{ requestId: string; credentialRequestJson: string }>(
    WALLET, '/credentials/request',
    { body: { action: built.action, signature, credentialOfferJson: offer.credentialOfferJson, credDefId: offer.credDefId } },
  )
  if (reqR.status !== 200) throw new Error(`request ${reqR.status}: ${reqR.raw}`)
  const issueR = await http<{ credentialJson: string }>(FAMILY, '/credential/issue', {
    body: {
      credentialOfferJson: offer.credentialOfferJson,
      credentialRequestJson: reqR.body!.credentialRequestJson,
      attributes: { relationship: 'parent', minorBirthYear: '2015', issuedYear: '2026' },
    },
  })
  if (issueR.status !== 200) throw new Error(`issue ${issueR.status}: ${issueR.raw}`)
  const storeR = await http<{ credentialId: string }>(WALLET, '/credentials/store', {
    body: {
      holderWalletId, requestId: reqR.body!.requestId,
      credentialJson: issueR.body!.credentialJson,
      credentialType: 'GuardianOfMinorCredential',
      issuerId: offer.issuerId, schemaId: offer.schemaId,
    },
  })
  if (storeR.status !== 200) throw new Error(`store ${storeR.status}: ${storeR.raw}`)
  return { credentialId: storeR.body!.credentialId, schemaId: offer.schemaId, credDefId: offer.credDefId, issuerId: offer.issuerId }
}

async function main() {
  console.log('\n=== Phase 8 — Chain-only verifier (cheqd-style) ===\n')
  console.log(`  RPC:              ${RPC_URL}`)
  console.log(`  Registry contract: ${REGISTRY}\n`)

  // Provision + accept.
  let personalWallet: string
  try {
    personalWallet = await provision('personal')
    pass('provision "personal" wallet for Maria')
  } catch (e) { fail('provision', e); process.exit(1) }

  let guardianCred: Awaited<ReturnType<typeof acceptGuardian>>
  try {
    guardianCred = await acceptGuardian('personal', personalWallet)
    pass(`accept guardian credential → ${guardianCred.credentialId}`)
  } catch (e) { fail('accept guardian credential', e); process.exit(1) }

  // Family signs a presentation request.
  let pr: Record<string, unknown>, verifierId: string, verifierAddress: `0x${string}`, verifierSignature: `0x${string}`
  try {
    const r = await http<{ presentationRequest: Record<string, unknown>; verifierId: string; verifierAddress: `0x${string}`; signature: `0x${string}` }>(
      FAMILY, '/verify/guardian/request',
    )
    if (r.status !== 200) throw new Error(`request ${r.status}: ${r.raw}`)
    pr = r.body!.presentationRequest
    verifierId = r.body!.verifierId
    verifierAddress = r.body!.verifierAddress
    verifierSignature = r.body!.signature
    pass('family-mcp returned signed presentation request')
  } catch (e) { fail('presentation request', e); process.exit(1) }

  // Wallet builds presentation.
  let presentation: string
  try {
    const { built, signature } = await buildAndSign(PRINCIPAL, 'personal', 'CreatePresentation', {
      counterpartyId: verifierId, purpose: 'phase8_guardian_proof',
      holderWalletId: personalWallet, proofRequest: pr,
      allowedReveal: [],
      allowedPredicates: [{ attribute: 'minorBirthYear', operator: '>=', value: 2006 }],
      forbiddenAttrs: ['relationship', 'issuedYear'],
    })
    const presR = await http<{ presentation: string }>(WALLET, '/proofs/present', {
      body: {
        action: built.action, signature,
        presentationRequest: pr,
        verifierId, verifierAddress, verifierSignature,
        credentialSelections: [{
          credentialId: guardianCred.credentialId,
          revealReferents: ['attr_holder'],
          predicateReferents: ['pred_guardian'],
        }],
      },
    })
    if (presR.status !== 200) throw new Error(`present ${presR.status}: ${presR.raw}`)
    presentation = presR.body!.presentation
    pass('wallet produced presentation')
  } catch (e) { fail('wallet present', e); process.exit(1) }

  // Chain-only verifier — no DB, no off-chain registry.
  try {
    const resolver = new OnChainResolver({
      rpcUrl: RPC_URL,
      chainId: CHAIN_ID,
      contractAddress: REGISTRY as `0x${string}`,
    })
    const reqPred = (pr.requested_predicates as Record<string, { restrictions: Array<{ cred_def_id: string }> }>).pred_guardian
    const credDefId = reqPred.restrictions[0].cred_def_id
    const credDef = await loadVerifiedCredDef(resolver, credDefId)
    const schema = await loadVerifiedSchema(resolver, credDef.schemaId)
    pass(`resolved credDef ${credDefId} + schema ${credDef.schemaId} from chain`)

    const ok = AnonCreds.verifierVerifyPresentation({
      presentationJson: presentation,
      presentationRequestJson: JSON.stringify(pr),
      schemasJson: { [credDef.schemaId]: schema.json },
      credDefsJson: { [credDefId]: credDef.json },
    })
    if (ok) pass('chain-only verifier VERIFIED guardian proof — no issuer DB used')
    else fail('chain-only verifier REJECTED guardian proof')
  } catch (e) { fail('chain-only verifier', e) }

  console.log(`\n[phase8] ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

void main()
