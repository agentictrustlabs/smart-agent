import { Hono } from 'hono'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { AnonCreds, evaluateProofPolicy, hashProofRequest } from '@smart-agent/privacy-creds'
import { gateExistingWalletAction } from '../auth/verify-wallet-action.js'
import { checkVerifierSignature } from '../auth/verifier-registry.js'
import { getCredential, getLinkSecret } from '../storage/askar.js'
import { loadVerifiedCredDef, loadVerifiedSchema } from '@smart-agent/credential-registry'
import { pairwiseHandle } from '@smart-agent/privacy-creds'
import { resolver } from '../registry/resolver.js'
import { db } from '../db/index.js'

export const proofRoutes = new Hono()

/**
 * POST /proofs/present
 *
 * Body: {
 *   action, signature,
 *   presentationRequest,           // full AnonCreds presentation request
 *   credentialSelections: [{       // which stored cred fills which slots
 *     credentialId,
 *     revealReferents: [...],
 *     predicateReferents: [...],
 *   }]
 * }
 *
 * Flow:
 *   1. verify wallet signature + consume nonce
 *   2. hash(presentationRequest) must match action.proofRequestHash
 *   3. run proof policy (forbidden attrs, allow-set, predicate rewrite)
 *   4. build schemas/credDefs maps from the registry
 *   5. load raw credentials from Askar
 *   6. anoncreds-rs createPresentation
 *   7. return presentation JSON + reveal/predicate summary for audit
 */
proofRoutes.post('/proofs/present', async (c) => {
  const body = await c.req.json<{
    action: WalletAction & { expiresAt: string | number | bigint }
    signature: `0x${string}`
    presentationRequest: Record<string, unknown>
    credentialSelections: Array<{
      credentialId: string
      revealReferents: string[]
      predicateReferents: string[]
    }>
    /** Verifier-signed request envelope. Only enforced when
     *  SSI_KNOWN_VERIFIERS lists the verifier's DID. Optional otherwise. */
    verifierId?: string
    verifierAddress?: `0x${string}`
    verifierSignature?: `0x${string}`
  }>()

  const action: WalletAction = { ...body.action, expiresAt: BigInt(body.action.expiresAt) }
  if (action.type !== 'CreatePresentation') {
    return c.json({ error: `unexpected action type: ${action.type}` }, 400)
  }

  const gate = await gateExistingWalletAction({ action, signature: body.signature })
  if (!gate.ok) return c.json({ error: gate.reason }, gate.status as 400 | 401 | 404 | 409)
  const hw = gate.holderWallet

  // Tamper-evidence: the exact proof-request body must match what was signed.
  const freshHash = hashProofRequest(body.presentationRequest)
  if (freshHash !== action.proofRequestHash) {
    return c.json({ error: 'proofRequestHash mismatch' }, 400)
  }

  // Verifier-registry check — only blocks when SSI_KNOWN_VERIFIERS is set.
  const vsig = await checkVerifierSignature({
    presentationRequest: body.presentationRequest,
    verifierId:          body.verifierId,
    verifierAddress:     body.verifierAddress,
    signature:           body.verifierSignature,
  })
  if (!vsig.ok) return c.json({ error: `verifier: ${vsig.reason}` }, 403)

  // Gather requested attrs/predicates from the presentation request, merged
  // across all selected credentials (Phase 1: usually just one).
  const reqAttrs = Object.values(
    (body.presentationRequest.requested_attributes as Record<string, { name: string }> | undefined) ?? {},
  ).map(a => a.name)
  const reqPreds = Object.values(
    (body.presentationRequest.requested_predicates as Record<string, { name: string; p_type: string; p_value: number }> | undefined) ?? {},
  ).map(p => ({ attribute: p.name, operator: p.p_type as '>=' | '<=' | '>' | '<', value: p.p_value }))

  // The attribute universe available in the selected credential(s).
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

  for (const sel of body.credentialSelections) {
    const rawRow = db.prepare(
      `SELECT cred_def_id as credDefId, schema_id as schemaId FROM credential_metadata WHERE id = ? AND holder_wallet_id = ?`,
    ).get(sel.credentialId, hw.id) as { credDefId: string; schemaId: string } | undefined
    if (!rawRow) return c.json({ error: `unknown credentialId: ${sel.credentialId}` }, 404)

    let credDef, schema
    try {
      credDef = await loadVerifiedCredDef(resolver, rawRow.credDefId)
      schema  = await loadVerifiedSchema(resolver, rawRow.schemaId)
    } catch (err) {
      return c.json({ error: `registry: ${(err as Error).message}` }, 403)
    }
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

  // Policy gate — anti-correlation belt-and-braces.
  const policy = evaluateProofPolicy({
    requestedRevealAttrs: reqAttrs,
    requestedPredicates: reqPreds,
    allowedReveal: JSON.parse(action.allowedReveal || '[]'),
    allowedPredicates: JSON.parse(action.allowedPredicates || '[]'),
    forbiddenAttrs: JSON.parse(action.forbiddenAttrs || '[]'),
    availableInCred: Array.from(availableAttrs),
  })
  if (!policy.ok) return c.json({ error: `policy denied: ${policy.reason}` }, 403)

  const linkSecret = await getLinkSecret(hw.askarProfile, hw.linkSecretId)

  // Pairwise handle: deterministic per (holderWalletId, verifierId). If the
  // request declares a self-attested `holder` slot we fill it; either way
  // the handle rides in auditSummary for the user's own record.
  const pwHandle = pairwiseHandle(hw.id, action.counterpartyId)
  const selfAttest: Record<string, string> = {}
  const requestedSelfAttested = new Set<string>()
  const selfAttestedHolderSlot = Object.entries(
    (body.presentationRequest.requested_attributes as Record<string, { name: string; restrictions?: unknown[] }> | undefined) ?? {},
  ).find(([_, def]) => def.name === 'holder' && (!def.restrictions || def.restrictions.length === 0))
  if (selfAttestedHolderSlot) {
    const referent = selfAttestedHolderSlot[0]
    selfAttest[referent] = pwHandle
    requestedSelfAttested.add(referent)
  }

  // Multi-credential: each stored-credential entry lists its own referents.
  // The holder self-attested referent is stripped from every entry's reveal
  // list so we don't double-cover it (self-attest wins).
  const presentation = AnonCreds.holderCreatePresentation({
    presentationRequestJson: JSON.stringify(body.presentationRequest),
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

  return c.json({
    presentation,
    auditSummary: {
      revealedAttrs: policy.reveal,
      predicates: policy.predicates,
      verifier: action.counterpartyId,
      purpose: action.purpose,
      actionHash: action.nonce,
      pairwiseHandle: pwHandle,
      holderBindingIncluded: selfAttestedHolderSlot !== undefined,
    },
  })
})

/** Extract attribute names from the canonical AnonCreds schema JSON. */
function attributeNamesFromSchemaJson(json: string): string[] {
  try {
    const obj = JSON.parse(json) as { attrNames?: string[] }
    return obj.attrNames ?? []
  } catch {
    return []
  }
}
