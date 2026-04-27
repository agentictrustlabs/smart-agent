import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import {
  geoIssuer,
  GEO_ISSUER_DID,
  LOCATION_SCHEMA_ID,
  LOCATION_CRED_DEF_ID,
  LOCATION_SPEC,
  ensureLocationRegistered,
} from '../issuers/location.js'

export const credentialRoutes = new Hono()

/**
 * POST /credential/offer
 *
 * Body: { credentialType: 'GeoLocationCredential' }
 * Returns: { offerId, credentialOfferJson, schemaId, credDefId, issuerId }
 */
credentialRoutes.post('/credential/offer', async (c) => {
  const { credentialType } = await c.req.json<{ credentialType: string }>()
  if (credentialType !== 'GeoLocationCredential') {
    return c.json({ error: 'unsupported credentialType' }, 400)
  }
  await ensureLocationRegistered()
  const credentialOfferJson = await geoIssuer.createOffer(LOCATION_CRED_DEF_ID)
  return c.json({
    offerId: `offer_${randomUUID()}`,
    credentialOfferJson,
    schemaId: LOCATION_SCHEMA_ID,
    credDefId: LOCATION_CRED_DEF_ID,
    issuerId: GEO_ISSUER_DID,
  })
})

/**
 * POST /credential/issue
 *
 * Body: {
 *   credentialOfferJson, credentialRequestJson,
 *   attributes: { featureId, featureName, city, region, country,
 *                 relation, confidence, validFrom, validUntil, attestedAt },
 * }
 * Returns: { credentialJson }
 */
credentialRoutes.post('/credential/issue', async (c) => {
  const body = await c.req.json<{
    credentialOfferJson: string
    credentialRequestJson: string
    attributes: Record<string, string>
  }>()
  // Validate that every required schema attribute is present and stringified.
  for (const name of LOCATION_SPEC.attributeNames) {
    if (!(name in body.attributes)) {
      return c.json({ error: `attribute "${name}" missing` }, 400)
    }
    if (typeof body.attributes[name] !== 'string') {
      return c.json({ error: `attribute "${name}" must be a string (AnonCreds requirement)` }, 400)
    }
  }
  const credentialJson = await geoIssuer.issue(
    LOCATION_CRED_DEF_ID,
    body.credentialOfferJson,
    body.credentialRequestJson,
    body.attributes,
  )
  return c.json({ credentialJson })
})
