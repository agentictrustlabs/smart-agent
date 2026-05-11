import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import {
  catalystIssuer,
  CATALYST_DID,
  MEMBERSHIP_SCHEMA_ID,
  MEMBERSHIP_CRED_DEF_ID,
  ensureMembershipRegistered,
} from '../issuers/membership.js'
import {
  ensureMarketplaceCredsRegistered,
  MARKETPLACE_CRED_SPECS,
} from '../issuers/marketplaceCreds.js'

export const credentialRoutes = new Hono()

interface CredentialKindLookup {
  credDefId: string
  schemaId: string
  ensure(): Promise<void>
}

function lookupKind(credentialType: string): CredentialKindLookup | null {
  if (credentialType === 'OrgMembershipCredential') {
    return {
      credDefId: MEMBERSHIP_CRED_DEF_ID,
      schemaId: MEMBERSHIP_SCHEMA_ID,
      ensure: ensureMembershipRegistered,
    }
  }
  const spec = MARKETPLACE_CRED_SPECS[credentialType]
  if (spec) {
    return {
      credDefId: spec.credDefId,
      schemaId: spec.schemaId,
      ensure: ensureMarketplaceCredsRegistered,
    }
  }
  return null
}

/**
 * POST /credential/offer
 *
 * Body: { credentialType: 'OrgMembershipCredential' | 'ProposalSubmitterCredential' | 'RoundVoterCredential' }
 * Returns: { offerId, credentialOfferJson, schemaId, credDefId, issuerId }
 */
credentialRoutes.post('/credential/offer', async (c) => {
  const { credentialType } = await c.req.json<{ credentialType: string }>()
  const kind = lookupKind(credentialType)
  if (!kind) {
    return c.json({ error: `unsupported credentialType: ${credentialType}` }, 400)
  }
  await kind.ensure()
  const credentialOfferJson = await catalystIssuer.createOffer(kind.credDefId)
  return c.json({
    offerId: `offer_${randomUUID()}`,
    credentialOfferJson,
    schemaId: kind.schemaId,
    credDefId: kind.credDefId,
    issuerId: CATALYST_DID,
  })
})

/**
 * POST /credential/issue
 *
 * Body: {
 *   credentialOfferJson,          // from the previous /offer
 *   credentialRequestJson,        // from the holder wallet
 *   attributes: Record<string, string>,
 *   credentialType?: string       // optional; falls back to OrgMembership for back-compat
 * }
 * Returns: { credentialJson }
 *
 * The credDefId is derived from the offer (it's bound at offer creation
 * time), so the explicit credentialType param is informational; we only
 * need it to short-circuit the AnonCreds offer-vs-credDef binding check
 * when the caller already knows which kind they're issuing.
 */
credentialRoutes.post('/credential/issue', async (c) => {
  const body = await c.req.json<{
    credentialOfferJson: string
    credentialRequestJson: string
    attributes: Record<string, string>
    credentialType?: string
  }>()
  const credentialType = body.credentialType ?? 'OrgMembershipCredential'
  const kind = lookupKind(credentialType)
  if (!kind) {
    return c.json({ error: `unsupported credentialType: ${credentialType}` }, 400)
  }
  const credentialJson = await catalystIssuer.issue(
    kind.credDefId,
    body.credentialOfferJson,
    body.credentialRequestJson,
    body.attributes,
  )
  return c.json({ credentialJson })
})
