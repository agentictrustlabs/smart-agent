/**
 * Phase 7 end-to-end — Catalyst NoCo Network users under the full feature set.
 *
 * Scenarios:
 *   S1. Maria (cat-user-001) creates two wallet contexts: "professional" + "personal".
 *   S2. Catalyst issues OrgMembership into Maria's "professional".
 *   S3. Family issues Guardian into Maria's "personal".
 *   S4. Maria also holds BOTH credentials in a third "combined" context —
 *       exercises multi-credential presentation.
 *   S5. Coach asks Maria for a guardian proof from "personal". Verify success.
 *   S6. Replay the same presentation_request twice. Second POST MUST fail 409.
 *   S7. Maria rotates link secret on "personal". Existing creds marked stale.
 *   S8. Cross-principal forgery — sign Maria's WalletAction with David's
 *       key → /wallet/provision MUST reject.
 *   S9. Verifier-sig enforcement — set SSI_KNOWN_VERIFIERS and ensure
 *       unsigned requests are rejected (optional; skipped if not configured).
 */

import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { walletActionDomain, WalletActionTypes, AnonCreds, hashProofRequest, type WalletAction } from '@smart-agent/privacy-creds'
import { anoncredsNodeJS } from '@hyperledger/anoncreds-nodejs'

AnonCreds.registerNativeBinding(anoncredsNodeJS)

const WALLET = process.env.SSI_WALLET_MCP_URL ?? 'http://127.0.0.1:3300'
const PERSON = process.env.PERSON_MCP_URL    ?? 'http://127.0.0.1:3200'
const ORG    = process.env.ORG_MCP_URL       ?? 'http://127.0.0.1:3400'
const FAMILY = process.env.FAMILY_MCP_URL    ?? 'http://127.0.0.1:3500'
const CHAIN_ID = Number(process.env.CHAIN_ID ?? '31337')
const VERIFIER = (process.env.SSI_ACTION_VERIFIER_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`

// Each Catalyst demo user has a deterministic-for-demo private key.
const MARIA_KEY = ('0x' + 'a'.repeat(64)) as `0x${string}`
const DAVID_KEY = ('0x' + 'b'.repeat(64)) as `0x${string}`
const maria = privateKeyToAccount(MARIA_KEY)
const david = privateKeyToAccount(DAVID_KEY)
const PRINCIPAL = 'person_cat-user-001-maria-phase7'

let passed = 0
let failed = 0
const results: string[] = []

function nonce(): `0x${string}` { return ('0x' + Math.random().toString(16).slice(2).padEnd(64, '0').slice(0, 64)) as `0x${string}` }
function expiresIn(sec = 120): bigint { return BigInt(Math.floor(Date.now() / 1000) + sec) }
function pass(name: string)  { passed++; results.push('✅ ' + name); console.log('✅', name) }
function fail(name: string, err?: unknown) { failed++; results.push('❌ ' + name + (err ? ` — ${err}` : '')); console.error('❌', name, err ?? '') }

async function signAction(account: typeof maria, action: WalletAction) {
  return account.signTypedData({
    domain: walletActionDomain(CHAIN_ID, VERIFIER),
    types: WalletActionTypes,
    primaryType: 'WalletAction',
    message: action,
  })
}

async function http<T>(base: string, path: string, opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; body: T | null; raw: string }> {
  const r = await fetch(`${base}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    body: opts.body === undefined
      ? undefined
      : typeof opts.body === 'string' ? opts.body
        : JSON.stringify(opts.body, (_, v) => typeof v === 'bigint' ? v.toString() : v),
  })
  const txt = await r.text()
  let body: T | null = null
  try { body = JSON.parse(txt) as T } catch { /* keep null */ }
  return { status: r.status, body, raw: txt }
}

async function personTool<T>(name: string, args: unknown): Promise<T> {
  const r = await http<T>(PERSON, `/tools/${name}`, { body: { tool: name, args } })
  if (r.status !== 200) throw new Error(`person.${name} ${r.status}: ${r.raw}`)
  return r.body as T
}

async function buildAndSign(principal: string, context: string, type: string, extra: Record<string, unknown> = {}, signer = maria) {
  const built = await personTool<{ action: WalletAction & { expiresAt: string } }>(
    'ssi_create_wallet_action',
    { principal, walletContext: context, type, ...extra },
  )
  const action: WalletAction = { ...built.action, expiresAt: BigInt(built.action.expiresAt) }
  const signature = await signAction(signer, action)
  return { built, action, signature }
}

async function provision(context: string) {
  const { built, signature } = await buildAndSign(PRINCIPAL, context, 'ProvisionHolderWallet', { counterpartyId: 'self', purpose: `provision ${context}` })
  const r = await http<{ holderWalletId: string }>(WALLET, '/wallet/provision', {
    body: { action: built.action, signature, expectedSigner: maria.address },
  })
  if (r.status !== 200) throw new Error(`provision ${context} ${r.status}: ${r.raw}`)
  return r.body!.holderWalletId
}

async function acceptFromOrg(context: string, holderWalletId: string, attrs: Record<string, string>) {
  const offerR = await http<{ credentialOfferJson: string; credDefId: string; schemaId: string; issuerId: string }>(
    ORG, '/credential/offer', { body: { credentialType: 'OrgMembershipCredential' } },
  )
  const offer = offerR.body!
  const { built, signature } = await buildAndSign(PRINCIPAL, context, 'AcceptCredentialOffer', {
    counterpartyId: offer.issuerId, credentialType: 'OrgMembershipCredential', holderWalletId,
  })
  const reqR = await http<{ requestId: string; credentialRequestJson: string }>(
    WALLET, '/credentials/request',
    { body: { action: built.action, signature, credentialOfferJson: offer.credentialOfferJson, credDefId: offer.credDefId } },
  )
  const issueR = await http<{ credentialJson: string }>(ORG, '/credential/issue', {
    body: { credentialOfferJson: offer.credentialOfferJson, credentialRequestJson: reqR.body!.credentialRequestJson, attributes: attrs },
  })
  const storeR = await http<{ credentialId: string }>(WALLET, '/credentials/store', {
    body: {
      holderWalletId, requestId: reqR.body!.requestId,
      credentialJson: issueR.body!.credentialJson,
      credentialType: 'OrgMembershipCredential',
      issuerId: offer.issuerId, schemaId: offer.schemaId,
    },
  })
  return { credentialId: storeR.body!.credentialId, schemaId: offer.schemaId, credDefId: offer.credDefId, issuerId: offer.issuerId }
}

async function acceptFromFamily(context: string, holderWalletId: string, attrs: Record<string, string>) {
  const offerR = await http<{ credentialOfferJson: string; credDefId: string; schemaId: string; issuerId: string }>(
    FAMILY, '/credential/offer', { body: { credentialType: 'GuardianOfMinorCredential' } },
  )
  const offer = offerR.body!
  const { built, signature } = await buildAndSign(PRINCIPAL, context, 'AcceptCredentialOffer', {
    counterpartyId: offer.issuerId, credentialType: 'GuardianOfMinorCredential', holderWalletId,
  })
  const reqR = await http<{ requestId: string; credentialRequestJson: string }>(
    WALLET, '/credentials/request',
    { body: { action: built.action, signature, credentialOfferJson: offer.credentialOfferJson, credDefId: offer.credDefId } },
  )
  const issueR = await http<{ credentialJson: string }>(FAMILY, '/credential/issue', {
    body: { credentialOfferJson: offer.credentialOfferJson, credentialRequestJson: reqR.body!.credentialRequestJson, attributes: attrs },
  })
  const storeR = await http<{ credentialId: string }>(WALLET, '/credentials/store', {
    body: {
      holderWalletId, requestId: reqR.body!.requestId,
      credentialJson: issueR.body!.credentialJson,
      credentialType: 'GuardianOfMinorCredential',
      issuerId: offer.issuerId, schemaId: offer.schemaId,
    },
  })
  return { credentialId: storeR.body!.credentialId, schemaId: offer.schemaId, credDefId: offer.credDefId, issuerId: offer.issuerId }
}

async function main() {
  console.log('=== Phase 7 — Catalyst multi-user scenarios ===')
  console.log('Maria EOA:', maria.address)
  console.log('David EOA:', david.address)

  // ── S1: provision two contexts ────────────────────────────────────────────
  try {
    const prof = await provision('professional')
    const pers = await provision('personal')
    if (prof === pers) throw new Error('different contexts returned same wallet id')
    pass('S1: Maria has two distinct wallets (professional, personal)')
  } catch (e) { fail('S1: provision two contexts', e) }

  // Re-lookup for convenience
  const lookup = async (context: string) => {
    const r = await http<{ holderWalletId: string }>(WALLET, `/wallet/${encodeURIComponent(PRINCIPAL)}/${encodeURIComponent(context)}`)
    if (r.status !== 200) throw new Error(`lookup ${context}: ${r.raw}`)
    return r.body!.holderWalletId
  }
  const professional = await lookup('professional')
  const personal     = await lookup('personal')

  // ── S2: Catalyst → professional OrgMembership ─────────────────────────────
  try {
    const cred = await acceptFromOrg('professional', professional, {
      membershipStatus: 'active', role: 'leader', joinedYear: '2024', circleId: 'circle_wellington',
    })
    pass(`S2: OrgMembership stored in professional (${cred.credentialId})`)
  } catch (e) { fail('S2: accept membership into professional', e) }

  // ── S3: Family → personal Guardian ────────────────────────────────────────
  let guardianCredId = ''
  try {
    const cred = await acceptFromFamily('personal', personal, {
      relationship: 'parent', minorBirthYear: '2015', issuedYear: '2026',
    })
    guardianCredId = cred.credentialId
    pass(`S3: Guardian stored in personal (${cred.credentialId})`)
  } catch (e) { fail('S3: accept guardian into personal', e) }

  // ── S4: combined context holds BOTH creds → multi-cred proof ──────────────
  try {
    const combined = await provision('combined')
    const org = await acceptFromOrg('combined', combined, {
      membershipStatus: 'active', role: 'member', joinedYear: '2022', circleId: 'circle_laporte',
    })
    const fam = await acceptFromFamily('combined', combined, {
      relationship: 'legal-guardian', minorBirthYear: '2010', issuedYear: '2026',
    })
    pass(`S4a: combined holds OrgMembership + Guardian (${org.credentialId}, ${fam.credentialId})`)

    // Build a compound presentation request: role (from membership) + minorBirthYear ≥ 2006 (from guardian)
    const { Nonce } = await import('@hyperledger/anoncreds-shared')
    const compoundRequest = {
      name: 'compound-demo', version: '1.0', nonce: Nonce.generate(),
      requested_attributes: {
        attr_role: { name: 'role', restrictions: [{ cred_def_id: org.credDefId }] },
      },
      requested_predicates: {
        pred_guardian: { name: 'minorBirthYear', p_type: '>=', p_value: 2006, restrictions: [{ cred_def_id: fam.credDefId }] },
      },
    }
    const { built, signature } = await buildAndSign(PRINCIPAL, 'combined', 'CreatePresentation', {
      counterpartyId: 'did:ethr:verifier:test', purpose: 'multi-cred-demo',
      holderWalletId: combined,
      proofRequest: compoundRequest, allowedReveal: ['role'],
      allowedPredicates: [{ attribute: 'minorBirthYear', operator: '>=', value: 2006 }],
      forbiddenAttrs: [],
    })
    const presR = await http<{ presentation: string }>(WALLET, '/proofs/present', {
      body: {
        action: built.action, signature,
        presentationRequest: compoundRequest,
        credentialSelections: [
          { credentialId: org.credentialId, revealReferents: ['attr_role'],      predicateReferents: []              },
          { credentialId: fam.credentialId, revealReferents: [],                  predicateReferents: ['pred_guardian'] },
        ],
      },
    })
    if (presR.status !== 200) throw new Error(`present ${presR.status}: ${presR.raw}`)

    // Verify via AnonCreds — OnChainResolver only, no issuer DB in scope.
    const { OnChainResolver, loadVerifiedSchema, loadVerifiedCredDef } = await import('@smart-agent/credential-registry')
    const registryAddr = process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS as `0x${string}` | undefined
    if (!registryAddr) throw new Error('CREDENTIAL_REGISTRY_CONTRACT_ADDRESS env is required')
    const resolver = new OnChainResolver({
      rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
      chainId: CHAIN_ID,
      contractAddress: registryAddr,
    })
    const orgSchema  = await loadVerifiedSchema(resolver, org.schemaId)
    const orgDef     = await loadVerifiedCredDef(resolver, org.credDefId)
    const famSchema  = await loadVerifiedSchema(resolver, fam.schemaId)
    const famDef     = await loadVerifiedCredDef(resolver, fam.credDefId)
    const ok = AnonCreds.verifierVerifyPresentation({
      presentationJson: presR.body!.presentation,
      presentationRequestJson: JSON.stringify(compoundRequest),
      schemasJson:  { [org.schemaId]: orgSchema.json,  [fam.schemaId]: famSchema.json  },
      credDefsJson: { [org.credDefId]: orgDef.json,   [fam.credDefId]: famDef.json    },
    })
    if (ok) pass('S4b: multi-credential proof verifies')
    else fail('S4b: multi-credential proof FAILED verification')
  } catch (e) { fail('S4: multi-credential proof', e) }

  // ── S5: guardian proof to coach (family-mcp verifier) ─────────────────────
  let reusedPresentation = ''
  let reusedRequest: Record<string, unknown> | null = null
  try {
    const req = await http<{
      presentationRequest: Record<string, unknown>
      verifierId: string
      verifierAddress: `0x${string}`
      signature: `0x${string}`
    }>(FAMILY, '/verify/guardian/request')
    const pr = req.body!
    reusedRequest = pr.presentationRequest

    const { built, signature } = await buildAndSign(PRINCIPAL, 'personal', 'CreatePresentation', {
      counterpartyId: pr.verifierId, purpose: 'coach_onboarding',
      holderWalletId: personal, proofRequest: pr.presentationRequest,
      allowedReveal: [], allowedPredicates: [{ attribute: 'minorBirthYear', operator: '>=', value: 2006 }],
      forbiddenAttrs: ['relationship', 'issuedYear'],
    })
    const presR = await http<{ presentation: string }>(WALLET, '/proofs/present', {
      body: {
        action: built.action, signature,
        presentationRequest: pr.presentationRequest,
        verifierId: pr.verifierId, verifierAddress: pr.verifierAddress, verifierSignature: pr.signature,
        credentialSelections: [{
          credentialId: guardianCredId,
          revealReferents: ['attr_holder'], predicateReferents: ['pred_guardian'],
        }],
      },
    })
    if (presR.status !== 200) throw new Error(`present ${presR.status}: ${presR.raw}`)
    reusedPresentation = presR.body!.presentation

    const checkR = await http<{ verified: boolean; reason?: string }>(
      FAMILY, '/verify/guardian/check',
      { body: { presentation: presR.body!.presentation, presentationRequest: pr.presentationRequest } },
    )
    if (checkR.body?.verified) pass('S5: coach verifies guardian proof from personal wallet')
    else fail('S5: coach verification failed', checkR.body?.reason ?? checkR.raw)
  } catch (e) { fail('S5: present to coach', e) }

  // ── S6: replay same proof → 409 rejection ─────────────────────────────────
  try {
    if (!reusedPresentation || !reusedRequest) throw new Error('S5 did not produce a reusable proof')
    const replayR = await http<{ verified: boolean; replay?: boolean; reason?: string }>(
      FAMILY, '/verify/guardian/check',
      { body: { presentation: reusedPresentation, presentationRequest: reusedRequest } },
    )
    if (replayR.status === 409 && replayR.body?.replay) pass('S6: replay rejected (409 nonce already consumed)')
    else fail(`S6: replay not rejected (status ${replayR.status}, body ${replayR.raw.slice(0, 200)})`)
  } catch (e) { fail('S6: replay attack', e) }

  // ── S7: rotate link secret on personal ────────────────────────────────────
  try {
    const { built, signature } = await buildAndSign(PRINCIPAL, 'personal', 'RotateLinkSecret', {
      counterpartyId: 'self', purpose: 'rotate',
      holderWalletId: personal,
    })
    const rotR = await http<{ oldLinkSecretId: string; newLinkSecretId: string; credentialsMarkedStale: number }>(
      WALLET, '/wallet/rotate-link-secret', { body: { action: built.action, signature } },
    )
    if (rotR.status === 200 && rotR.body!.oldLinkSecretId !== rotR.body!.newLinkSecretId && rotR.body!.credentialsMarkedStale >= 1) {
      pass(`S7: rotate link secret on personal — ${rotR.body!.credentialsMarkedStale} cred(s) marked stale`)
    } else {
      fail(`S7: rotate link secret — unexpected result ${rotR.raw.slice(0, 200)}`)
    }
  } catch (e) { fail('S7: rotate link secret', e) }

  // ── S8: cross-principal forgery ────────────────────────────────────────────
  try {
    const attackerPrincipal = 'person_attacker'
    const { built, signature } = await buildAndSign(attackerPrincipal, 'default', 'ProvisionHolderWallet', {
      counterpartyId: 'self', purpose: 'provision',
    }, david)
    // Claim Maria as the signer, but attacker signed the body
    const r = await http<{ error?: string }>(WALLET, '/wallet/provision', {
      body: { action: built.action, signature, expectedSigner: maria.address },
    })
    if (r.status >= 400 && r.body?.error) pass(`S8: cross-principal forgery rejected (${r.body.error})`)
    else fail(`S8: forgery accepted (status ${r.status}, body ${r.raw.slice(0, 200)})`)
  } catch (e) { fail('S8: cross-principal forgery', e) }

  // ── S9: verifier-sig enforcement (opt-in via SSI_KNOWN_VERIFIERS) ─────────
  try {
    if (!process.env.SSI_KNOWN_VERIFIERS) {
      console.log('ℹ️  S9 skipped — SSI_KNOWN_VERIFIERS not set (signature-enforcement off by design)')
    } else {
      const { built, signature } = await buildAndSign(PRINCIPAL, 'personal', 'CreatePresentation', {
        counterpartyId: 'did:ethr:unknown',
        purpose: 'attack', holderWalletId: personal,
        proofRequest: { nonce: '1', name: 'x', version: '1', requested_attributes: {}, requested_predicates: {} },
        allowedReveal: [], allowedPredicates: [], forbiddenAttrs: [],
      })
      const r = await http<{ error?: string }>(WALLET, '/proofs/present', {
        body: {
          action: built.action, signature,
          presentationRequest: { nonce: '1', name: 'x', version: '1', requested_attributes: {}, requested_predicates: {} },
          credentialSelections: [],
          // NO verifierId/verifierSignature
        },
      })
      if (r.status === 403) pass('S9: unsigned verifier request rejected')
      else fail(`S9: verifier-sig enforcement weak (status ${r.status})`)
    }
  } catch (e) { fail('S9: verifier-sig enforcement', e) }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60))
  console.log(`RESULTS: ${passed} passed, ${failed} failed`)
  console.log('='.repeat(60))
  for (const r of results) console.log(r)
  if (failed > 0) process.exit(1)
}

main().catch(e => { console.error('harness crashed:', e); process.exit(2) })
