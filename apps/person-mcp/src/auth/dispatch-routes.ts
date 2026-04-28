/**
 * /wallet-action/dispatch — verify-and-execute entry point.
 *
 * Replaces the per-route ad-hoc gating in /wallet/provision,
 * /credentials/store, /proofs/present, etc. One contract:
 *
 *   POST /wallet-action/dispatch
 *   {
 *     action:           WalletActionV1,
 *     actionSignature:  0x...,
 *     sessionId:        "...",
 *     payload:          { ...action-specific params }
 *   }
 *
 * Pipeline:
 *   1. verifyDelegatedWalletAction (signature, scope, risk, replay).
 *   2. Assert hashCanonical(payload) === action.action.payloadHash.
 *   3. Route to the internal handler keyed on action.action.type.
 *   4. Audit entry already appended by the verifier.
 *
 * Action handlers live in this file (provisionHolderWallet, etc.) and
 * call into the same SSI storage helpers the legacy routes used.
 */

import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import {
  verifyDelegatedWalletAction,
  DelegatedActionDenied,
} from './verify-delegated-action.js'
import {
  hashCanonical,
  type WalletActionV1,
} from '@smart-agent/privacy-creds/session-grant'
import {
  AnonCreds,
  evidenceCommit,
  trustScore,
  sharedCount,
  publicSetCommit,
  canonicalOrgId,
  pairwiseHandle,
  evaluateProofPolicy,
  type MatchAgainstPublicSetBody,
} from '@smart-agent/privacy-creds'
import {
  askarProfileFor,
  getHolderWalletByContext,
  insertHolderWallet,
  newHolderWalletId,
  newLinkSecretId,
  normalizeWalletContext,
  getHolderWalletById,
} from '../ssi/storage/wallets.js'
import {
  createProfile,
  putLinkSecret,
  getLinkSecret,
  putCredentialRequestMeta,
  takeCredentialRequestMeta,
  putCredential,
  getCredential,
} from '../ssi/storage/askar.js'
import {
  insertCredentialMetadata,
  listCredentialMetadata,
} from '../ssi/storage/cred-metadata.js'
import { insertProofAudit } from '../ssi/storage/proof-audit.js'
import { loadVerifiedCredDef, loadVerifiedSchema } from '@smart-agent/credential-registry'
import { resolver } from '../ssi/registry/resolver.js'
import { getOnChainOrgsForPrincipal } from '../ssi/registry/on-chain-orgs.js'
import { db } from '../ssi/db/index.js'

export const dispatchRoutes = new Hono()

dispatchRoutes.post('/wallet-action/dispatch', async (c) => {
  const body = await c.req.json<{
    action: WalletActionV1
    actionSignature: `0x${string}`
    sessionId: string
    payload: Record<string, unknown>
  }>()

  const serviceName = process.env.PERSON_MCP_SERVICE_NAME ?? 'person-mcp'

  // Payload integrity: action commits to hashCanonical(payload).
  const payloadHash = hashCanonical(body.payload as unknown as Parameters<typeof hashCanonical>[0])
  if (payloadHash !== body.action.action.payloadHash) {
    return c.json({ ok: false, code: 'payload_hash_mismatch', detail: 'payload does not match action.payloadHash' }, 400)
  }

  // Verify (also burns nonce, slides idle deadline, audits "allowed").
  try {
    await verifyDelegatedWalletAction(
      { action: body.action, actionSignature: body.actionSignature, sessionId: body.sessionId },
      { serviceName },
    )
  } catch (err) {
    if (err instanceof DelegatedActionDenied) {
      return c.json({ ok: false, code: err.code, detail: err.detail }, 403)
    }
    return c.json({ ok: false, code: 'verifier_error', detail: (err as Error).message }, 500)
  }

  // Route by action type.
  try {
    switch (body.action.action.type) {
      case 'ProvisionHolderWallet':
        return c.json(await provisionHolderWallet(body.payload, body.action.actor.sessionSignerAddress))
      case 'AcceptCredentialOffer':
        return c.json(await acceptCredentialOffer(body.payload))
      case 'MatchAgainstPublicSet':
        return c.json(await matchAgainstPublicSet(body.payload))
      case 'CreatePresentation':
        return c.json(await createPresentation(body.payload, body.action))
      case 'MatchAgainstPublicGeoSet':
      case 'RotateLinkSecret':
      case 'RevokeCredential':
        return c.json({ ok: false, code: 'not_implemented', detail: `${body.action.action.type} dispatch handler pending` }, 501)
      default:
        return c.json({ ok: false, code: 'unknown_action_type', detail: body.action.action.type }, 400)
    }
  } catch (err) {
    return c.json({ ok: false, code: 'handler_failed', detail: (err as Error).message }, 500)
  }
})

interface ProvisionPayload {
  personPrincipal: string
  walletContext: string
}

async function provisionHolderWallet(
  payload: Record<string, unknown>,
  expectedSigner: `0x${string}`,
): Promise<unknown> {
  const p = payload as unknown as ProvisionPayload
  if (!p.personPrincipal || !p.walletContext) {
    throw new Error('payload requires personPrincipal and walletContext')
  }
  const context = normalizeWalletContext(p.walletContext)
  if (context === null) {
    throw new Error('walletContext must be ≤32 chars of [a-z0-9_-] starting with a letter/digit')
  }
  if (p.walletContext !== context) {
    throw new Error(`walletContext must be normalized (got "${p.walletContext}", expected "${context}")`)
  }

  // Idempotency per (principal, context).
  const existing = getHolderWalletByContext(p.personPrincipal, context)
  if (existing) {
    return {
      ok: true,
      holderWalletId: existing.id,
      walletContext: existing.walletContext,
      linkSecretId: existing.linkSecretId,
      askarProfile: existing.askarProfile,
      idempotent: true,
    }
  }

  const holderWalletId = newHolderWalletId()
  const linkSecretId = newLinkSecretId()
  const askarProfile = askarProfileFor(p.personPrincipal, context)

  await createProfile(askarProfile)
  const linkSecret = AnonCreds.createLinkSecretValue()
  await putLinkSecret(askarProfile, linkSecretId, linkSecret)

  insertHolderWallet({
    id: holderWalletId,
    personPrincipal: p.personPrincipal,
    walletContext: context,
    signerEoa: expectedSigner,
    askarProfile,
    linkSecretId,
    status: 'active',
  })

  return {
    ok: true,
    holderWalletId,
    walletContext: context,
    linkSecretId,
    askarProfile,
    idempotent: false,
  }
}

// ─── AcceptCredentialOffer ──────────────────────────────────────────

interface AcceptOfferPayload {
  holderWalletId: string
  credentialOfferJson: string
  credDefId: string
}

async function acceptCredentialOffer(payload: Record<string, unknown>): Promise<unknown> {
  const p = payload as unknown as AcceptOfferPayload
  if (!p.holderWalletId || !p.credentialOfferJson || !p.credDefId) {
    throw new Error('payload requires holderWalletId, credentialOfferJson, credDefId')
  }

  const hw = getHolderWalletById(p.holderWalletId)
  if (!hw) throw new Error('holder wallet not found')

  let credDef
  try {
    credDef = await loadVerifiedCredDef(resolver, p.credDefId)
  } catch (err) {
    throw new Error(`credDef: ${(err as Error).message}`)
  }

  const linkSecret = await getLinkSecret(hw.askarProfile, hw.linkSecretId)

  const { credentialRequest, credentialRequestMetadata } = AnonCreds.holderCreateCredentialRequest({
    credentialOfferJson: p.credentialOfferJson,
    credentialDefinitionJson: credDef.json,
    linkSecret,
    linkSecretId: hw.linkSecretId,
    proverDid: hw.id,
  })

  const requestId = `req_${randomUUID()}`
  await putCredentialRequestMeta(
    hw.askarProfile,
    requestId,
    JSON.stringify({
      credentialRequestMetadata,
      credDefId: p.credDefId,
      credentialOfferJson: p.credentialOfferJson,
    }),
  )

  return { ok: true, requestId, credentialRequestJson: credentialRequest }
}

// ─── MatchAgainstPublicSet ──────────────────────────────────────────

interface MatchPayload {
  holderWalletId: string
  body: MatchAgainstPublicSetBody
}

async function matchAgainstPublicSet(payload: Record<string, unknown>): Promise<unknown> {
  const p = payload as unknown as MatchPayload
  if (!p.holderWalletId || !p.body) throw new Error('payload requires holderWalletId, body')

  const hw = getHolderWalletById(p.holderWalletId)
  if (!hw) throw new Error('holder wallet not found')

  const callerAddr = canonicalOrgId(p.body.callerAddress) as `0x${string}`
  const onChain = await getOnChainOrgsForPrincipal(callerAddr)
  const heldOnChain = onChain.map(canonicalOrgId)

  const heldAnonCreds: string[] = []
  for (const cred of listCredentialMetadata(hw.id)) {
    if (cred.status !== 'active') continue
    if (!cred.credentialType.toLowerCase().includes('membership')) continue
    if (cred.targetOrgAddress) heldAnonCreds.push(canonicalOrgId(cred.targetOrgAddress))
  }

  const heldSet = Array.from(new Set([...heldOnChain, ...heldAnonCreds]))
  const blockPin = p.body.blockPin && p.body.blockPin !== '0' ? BigInt(p.body.blockPin) : undefined

  const hits = p.body.candidates.map(cand => {
    const score = trustScore({ publicSet: cand.publicSet, heldSet, blockPin })
    const shared = sharedCount(cand.publicSet, heldSet)
    const commit = evidenceCommit({
      publicSet: cand.publicSet,
      heldSet,
      policyId: p.body.policyId,
      blockPin,
    })
    return { id: cand.id, score, sharedCount: shared, evidenceCommit: commit }
  })

  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]
    const cand = p.body.candidates[i]
    insertProofAudit({
      holderWalletId: hw.id,
      principal: hw.personPrincipal,
      counterpartyId: `discovery:peer:${h.id.toLowerCase()}`,
      policyId: p.body.policyId,
      blockPin: p.body.blockPin,
      publicSetCommit: publicSetCommit(cand.publicSet),
      evidenceCommit: h.evidenceCommit,
      score: h.score,
      sharedCount: h.sharedCount,
    })
  }

  return {
    ok: true,
    policyId: p.body.policyId,
    blockPin: p.body.blockPin,
    hits,
  }
}

// ─── CreatePresentation ─────────────────────────────────────────────

interface CreatePresentationPayload {
  holderWalletId: string
  presentationRequest: Record<string, unknown>
  credentialSelections: Array<{
    credentialId: string
    revealReferents: string[]
    predicateReferents: string[]
  }>
  /** Anti-correlation policy carried in the action payload (replaces the
   *  EIP-712 fields on the legacy WalletAction). */
  allowedReveal: string[]
  allowedPredicates: Array<{ attribute: string; operator: '>=' | '<=' | '>' | '<'; value: number }>
  forbiddenAttrs: string[]
  /** Verifier identifier for pairwise-handle binding + audit. */
  counterpartyId: string
  purpose: string
}

async function createPresentation(
  payload: Record<string, unknown>,
  action: WalletActionV1,
): Promise<unknown> {
  const p = payload as unknown as CreatePresentationPayload
  if (!p.holderWalletId || !p.presentationRequest || !p.credentialSelections) {
    throw new Error('payload requires holderWalletId, presentationRequest, credentialSelections')
  }

  const hw = getHolderWalletById(p.holderWalletId)
  if (!hw) throw new Error('holder wallet not found')

  const reqAttrs = Object.values(
    (p.presentationRequest.requested_attributes as Record<string, { name: string }> | undefined) ?? {},
  ).map(a => a.name)
  const reqPreds = Object.values(
    (p.presentationRequest.requested_predicates as Record<string, { name: string; p_type: string; p_value: number }> | undefined) ?? {},
  ).map(pp => ({ attribute: pp.name, operator: pp.p_type as '>=' | '<=' | '>' | '<', value: pp.p_value }))

  const availableAttrs = new Set<string>()
  const schemasJson: Record<string, string> = {}
  const credDefsJson: Record<string, string> = {}
  const loadedCreds: Array<{
    credentialJson: string
    revealAttributes: string[]
    predicateReferents: string[]
    credDefId: string
    schemaId: string
  }> = []

  for (const sel of p.credentialSelections) {
    const rawRow = db.prepare(
      `SELECT cred_def_id as credDefId, schema_id as schemaId FROM credential_metadata WHERE id = ? AND holder_wallet_id = ?`,
    ).get(sel.credentialId, hw.id) as { credDefId: string; schemaId: string } | undefined
    if (!rawRow) throw new Error(`unknown credentialId: ${sel.credentialId}`)

    const credDef = await loadVerifiedCredDef(resolver, rawRow.credDefId)
    const schema = await loadVerifiedSchema(resolver, rawRow.schemaId)
    credDefsJson[rawRow.credDefId] = credDef.json
    schemasJson[rawRow.schemaId] = schema.json
    for (const a of attributeNamesFromSchemaJson(schema.json)) availableAttrs.add(a)

    const credJson = await getCredential(hw.askarProfile, sel.credentialId)
    loadedCreds.push({
      credentialJson: credJson,
      revealAttributes: sel.revealReferents,
      predicateReferents: sel.predicateReferents,
      credDefId: rawRow.credDefId,
      schemaId: rawRow.schemaId,
    })
  }

  const policy = evaluateProofPolicy({
    requestedRevealAttrs: reqAttrs,
    requestedPredicates: reqPreds,
    allowedReveal: p.allowedReveal ?? [],
    allowedPredicates: p.allowedPredicates ?? [],
    forbiddenAttrs: p.forbiddenAttrs ?? [],
    availableInCred: Array.from(availableAttrs),
  })
  if (!policy.ok) throw new Error(`policy denied: ${policy.reason}`)

  const linkSecret = await getLinkSecret(hw.askarProfile, hw.linkSecretId)
  const pwHandle = pairwiseHandle(hw.id, p.counterpartyId)
  const selfAttest: Record<string, string> = {}
  const requestedSelfAttested = new Set<string>()
  const selfAttestedHolderSlot = Object.entries(
    (p.presentationRequest.requested_attributes as Record<string, { name: string; restrictions?: unknown[] }> | undefined) ?? {},
  ).find(([_, def]) => def.name === 'holder' && (!def.restrictions || def.restrictions.length === 0))
  if (selfAttestedHolderSlot) {
    const referent = selfAttestedHolderSlot[0]
    selfAttest[referent] = pwHandle
    requestedSelfAttested.add(referent)
  }

  const presentation = AnonCreds.holderCreatePresentation({
    presentationRequestJson: JSON.stringify(p.presentationRequest),
    credentials: loadedCreds.map(c => ({
      credentialJson: c.credentialJson,
      revealAttrReferents: c.revealAttributes.filter(r => !requestedSelfAttested.has(r)),
      predicateReferents: c.predicateReferents,
    })),
    schemasJson,
    credDefsJson,
    linkSecret,
    selfAttestedAttributes: Object.keys(selfAttest).length > 0 ? selfAttest : undefined,
  })

  return {
    ok: true,
    presentation,
    auditSummary: {
      revealedAttrs: policy.reveal,
      predicates: policy.predicates,
      verifier: p.counterpartyId,
      purpose: p.purpose,
      actionHash: action.actionId,
      pairwiseHandle: pwHandle,
      holderBindingIncluded: selfAttestedHolderSlot !== undefined,
    },
  }
}

function attributeNamesFromSchemaJson(json: string): string[] {
  try {
    const obj = JSON.parse(json) as { attrNames?: string[] }
    return obj.attrNames ?? []
  } catch {
    return []
  }
}
