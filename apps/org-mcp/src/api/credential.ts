import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import {
  catalystIssuer,
  CATALYST_DID,
  MEMBERSHIP_SCHEMA_ID,
  MEMBERSHIP_CRED_DEF_ID,
  ensureMembershipRegistered,
} from '../issuers/membership.js'

export const credentialRoutes = new Hono()

/**
 * POST /credential/offer
 *
 * Body: { credentialType: 'OrgMembershipCredential' }
 *   (only one type supported in Phase 4)
 * Returns: {
 *   offerId, credentialOfferJson,
 *   schemaId, credDefId, issuerId
 * }
 */
credentialRoutes.post('/credential/offer', async (c) => {
  const { credentialType } = await c.req.json<{ credentialType: string }>()
  if (credentialType !== 'OrgMembershipCredential') {
    return c.json({ error: 'unsupported credentialType' }, 400)
  }
  await ensureMembershipRegistered()
  const credentialOfferJson = catalystIssuer.createOffer(MEMBERSHIP_CRED_DEF_ID)
  return c.json({
    offerId: `offer_${randomUUID()}`,
    credentialOfferJson,
    schemaId: MEMBERSHIP_SCHEMA_ID,
    credDefId: MEMBERSHIP_CRED_DEF_ID,
    issuerId: CATALYST_DID,
  })
})

/**
 * POST /credential/issue
 *
 * Body: {
 *   credentialOfferJson,          // from the previous /offer
 *   credentialRequestJson,        // from the holder wallet
 *   attributes: {                 // must match schema attrs
 *     membershipStatus, role, joinedYear, circleId
 *   }
 * }
 * Returns: { credentialJson }
 */
credentialRoutes.post('/credential/issue', async (c) => {
  const body = await c.req.json<{
    credentialOfferJson: string
    credentialRequestJson: string
    attributes: Record<string, string>
  }>()
  const credentialJson = catalystIssuer.issue(
    MEMBERSHIP_CRED_DEF_ID,
    body.credentialOfferJson,
    body.credentialRequestJson,
    body.attributes,
  )
  return c.json({ credentialJson })
})
