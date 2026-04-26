/**
 * OID4VP adapter on ssi-wallet-mcp (Phase 5).
 *
 * The wallet is the OID4VP-Wallet; a verifier sends it an authorization_request
 * (simplified shape) and the wallet produces an authorization_response with
 * an `vp_token` that wraps an AnonCreds presentation.
 *
 * Scope of this adapter:
 *   - translate OID4VP presentation_definition ↔ AnonCreds presentation_request
 *   - the wallet still requires a signed WalletAction over the *AnonCreds*
 *     presentation request before building the proof (split authority holds)
 *   - response_mode is direct_post (wallet POSTs vp_token to response_uri)
 *
 * Not in scope: signed authorization requests, DCQL, cross-device QR flow.
 */

import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { AnonCreds, evaluateProofPolicy, hashProofRequest, pairwiseHandle } from '@smart-agent/privacy-creds'
import { gateExistingWalletAction } from '../auth/verify-wallet-action.js'
import { getCredential, getLinkSecret } from '../storage/askar.js'
import { loadVerifiedCredDef, loadVerifiedSchema } from '@smart-agent/credential-registry'
import { resolver } from '../registry/resolver.js'
import { db } from '../db/index.js'

export const oid4vpRoutes = new Hono()

/**
 * Presentation definitions in this adapter are a narrow subset of DIF PE:
 *   {
 *     id, input_descriptors: [{
 *       id, constraints: {
 *         fields: [{ path: "$.<attrName>", filter?: { type: "number", minimum?: n } }]
 *       }
 *     }]
 *   }
 * We translate each field to an AnonCreds requested_attribute (if no filter)
 * or requested_predicate (if a numeric filter is present).
 */

interface FieldConstraint {
  path: string
  filter?: { type: string; minimum?: number; maximum?: number }
}
interface InputDescriptor {
  id: string
  constraints: { fields: FieldConstraint[] }
  /** optional cred_def_id restriction */
  cred_def_id?: string
}
interface PresentationDefinition {
  id: string
  input_descriptors: InputDescriptor[]
}

function attrFromPath(path: string): string | null {
  const m = path.match(/^\$\.(.+)$/)
  return m ? m[1] : null
}

/**
 * Deterministic translation of a DIF-PE presentation_definition → AnonCreds
 * presentation_request. The caller supplies the nonce so the wallet-side
 * result is byte-identical to what they compute locally — this is what lets
 * /oid4vp/preview return a proofRequestHash that the wallet action can
 * pre-commit to.
 *
 * Referent naming is deterministic:
 *   holder self-attest  → "attr_holder"
 *   reveal attr "X"     → "attr_<X>"
 *   predicate attr "X"  → "pred_<X>"                    (single per attr)
 *   if multiple preds over the same attr → "pred_<X>_<operator>_<value>"
 */
function buildAnonCredsRequest(def: PresentationDefinition, nonce: string): {
  presentationRequest: Record<string, unknown>
  referentMap: { reveal: Record<string, string>; predicate: Record<string, string> }
} {
  const requested_attributes: Record<string, unknown> = {}
  const requested_predicates: Record<string, unknown> = {}
  const referentMap = { reveal: {} as Record<string, string>, predicate: {} as Record<string, string> }

  requested_attributes['attr_holder'] = { name: 'holder' }
  referentMap.reveal['attr_holder'] = 'holder'

  const predCounts: Record<string, number> = {}
  for (const idesc of def.input_descriptors) {
    for (const f of idesc.constraints.fields) {
      const attr = attrFromPath(f.path)
      if (!attr) continue
      if (f.filter?.type === 'number' && typeof f.filter.minimum === 'number') {
        const used = predCounts[attr] ?? 0
        const ref = used === 0 ? `pred_${attr}` : `pred_${attr}_${f.filter.minimum}`
        predCounts[attr] = used + 1
        requested_predicates[ref] = {
          name: attr,
          p_type: '>=',
          p_value: f.filter.minimum,
          restrictions: idesc.cred_def_id ? [{ cred_def_id: idesc.cred_def_id }] : undefined,
        }
        referentMap.predicate[ref] = attr
      } else {
        const ref = `attr_${attr}`
        requested_attributes[ref] = {
          name: attr,
          restrictions: idesc.cred_def_id ? [{ cred_def_id: idesc.cred_def_id }] : undefined,
        }
        referentMap.reveal[ref] = attr
      }
    }
  }

  return {
    presentationRequest: {
      name: `oid4vp/${def.id}`,
      version: '1.0',
      nonce,
      requested_attributes,
      requested_predicates,
    },
    referentMap,
  }
}

/**
 * POST /oid4vp/authorize
 *
 * Body: {
 *   presentation_definition,        // DIF-PE subset, see above
 *   credentialId,                   // wallet chooses which stored cred
 *   action, signature,              // WalletAction (type: CreatePresentation)
 * }
 *
 * Returns: { vp_token, presentation_submission, pairwiseHandle }
 *
 * The caller is expected to POST vp_token+presentation_submission to the
 * verifier's response_uri; we don't do that on behalf of the wallet here.
 */
/**
 * POST /oid4vp/preview
 *
 * Preview endpoint: give me the exact AnonCreds request + hash the wallet
 * will use for this presentation_definition + nonce. Lets callers build the
 * wallet action with the correct proofRequestHash before calling
 * /oid4vp/authorize.
 *
 * Body: { presentation_definition, nonce }
 * Returns: { presentationRequest, proofRequestHash, referentMap }
 */
oid4vpRoutes.post('/oid4vp/preview', async (c) => {
  const body = await c.req.json<{
    presentation_definition: PresentationDefinition
    nonce: string
  }>()
  if (!body.nonce) return c.json({ error: 'nonce is required (decimal string)' }, 400)
  const { presentationRequest, referentMap } = buildAnonCredsRequest(body.presentation_definition, body.nonce)
  return c.json({
    presentationRequest,
    proofRequestHash: hashProofRequest(presentationRequest),
    referentMap,
  })
})

oid4vpRoutes.post('/oid4vp/authorize', async (c) => {
  const body = await c.req.json<{
    presentation_definition: PresentationDefinition
    credentialId: string
    nonce: string                 // same nonce that was passed to /oid4vp/preview
    action: WalletAction & { expiresAt: string | number | bigint }
    signature: `0x${string}`
  }>()

  const action: WalletAction = { ...body.action, expiresAt: BigInt(body.action.expiresAt) }
  if (action.type !== 'CreatePresentation') {
    return c.json({ error: 'WalletAction.type must be CreatePresentation' }, 400)
  }
  if (!body.nonce) return c.json({ error: 'nonce is required (must match /oid4vp/preview)' }, 400)

  const gate = await gateExistingWalletAction({ action, signature: body.signature })
  if (!gate.ok) return c.json({ error: gate.reason }, gate.status as 400 | 401 | 404 | 409)
  const hw = gate.holderWallet

  const { presentationRequest, referentMap } = buildAnonCredsRequest(body.presentation_definition, body.nonce)

  // Tamper-evidence: action.proofRequestHash must match this built request.
  const freshHash = hashProofRequest(presentationRequest)
  if (freshHash !== action.proofRequestHash) {
    return c.json({ error: 'proofRequestHash mismatch (rebuild the WalletAction from /oid4vp/preview output)' }, 400)
  }

  const rawRow = db.prepare(
    `SELECT cred_def_id as credDefId, schema_id as schemaId FROM credential_metadata WHERE id = ? AND holder_wallet_id = ?`,
  ).get(body.credentialId, hw.id) as { credDefId: string; schemaId: string } | undefined
  if (!rawRow) return c.json({ error: `unknown credentialId: ${body.credentialId}` }, 404)

  let credDef, schema
  try {
    credDef = await loadVerifiedCredDef(resolver, rawRow.credDefId)
    schema  = await loadVerifiedSchema(resolver, rawRow.schemaId)
  } catch (err) {
    return c.json({ error: `registry: ${(err as Error).message}` }, 403)
  }

  const availableAttrs = new Set(attributeNamesFromSchemaJson(schema.json))
  const revealReferents = Object.entries(referentMap.reveal).filter(([, name]) => name !== 'holder').map(([ref]) => ref)
  const predicateReferents = Object.keys(referentMap.predicate)
  const revealAttrs = revealReferents.map(r => referentMap.reveal[r])
  const predicates = predicateReferents.map(r => ({
    attribute: referentMap.predicate[r], operator: '>=' as const,
    value: ((presentationRequest.requested_predicates as Record<string, { p_value: number }>)[r]).p_value,
  }))

  const policy = evaluateProofPolicy({
    requestedRevealAttrs: revealAttrs,
    requestedPredicates: predicates,
    allowedReveal: JSON.parse(action.allowedReveal || '[]'),
    allowedPredicates: JSON.parse(action.allowedPredicates || '[]'),
    forbiddenAttrs: JSON.parse(action.forbiddenAttrs || '[]'),
    availableInCred: Array.from(availableAttrs),
  })
  if (!policy.ok) return c.json({ error: `policy denied: ${policy.reason}` }, 403)

  const linkSecret = await getLinkSecret(hw.askarProfile, hw.linkSecretId)
  const credentialJson = await getCredential(hw.askarProfile, body.credentialId)
  const pwHandle = pairwiseHandle(hw.id, action.counterpartyId)

  const presentation = AnonCreds.holderCreatePresentation({
    presentationRequestJson: JSON.stringify(presentationRequest),
    credentials: [{
      credentialJson,
      revealAttrReferents: revealReferents,
      predicateReferents: predicateReferents,
    }],
    schemasJson: { [rawRow.schemaId]: schema.json },
    credDefsJson: { [rawRow.credDefId]: credDef.json },
    linkSecret,
    selfAttestedAttributes: { attr_holder: pwHandle },
  })

  const submission = {
    id: `sub_${randomUUID()}`,
    definition_id: body.presentation_definition.id,
    descriptor_map: body.presentation_definition.input_descriptors.map(i => ({
      id: i.id,
      format: 'anoncreds-v1',
      path: '$',
    })),
  }

  return c.json({
    vp_token: presentation,
    presentation_submission: submission,
    pairwiseHandle: pwHandle,
  })
})

function attributeNamesFromSchemaJson(json: string): string[] {
  try {
    const obj = JSON.parse(json) as { attrNames?: string[] }
    return obj.attrNames ?? []
  } catch {
    return []
  }
}
