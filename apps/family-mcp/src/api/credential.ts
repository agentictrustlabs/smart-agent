import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import {
  familyIssuer,
  FAMILY_DID,
  GUARDIAN_SCHEMA_ID,
  GUARDIAN_CRED_DEF_ID,
  ensureGuardianRegistered,
} from '../issuers/guardian.js'

export const credentialRoutes = new Hono()

credentialRoutes.post('/credential/offer', async (c) => {
  const { credentialType } = await c.req.json<{ credentialType: string }>()
  if (credentialType !== 'GuardianOfMinorCredential') {
    return c.json({ error: 'unsupported credentialType' }, 400)
  }
  await ensureGuardianRegistered()
  const credentialOfferJson = familyIssuer.createOffer(GUARDIAN_CRED_DEF_ID)
  return c.json({
    offerId: `offer_${randomUUID()}`,
    credentialOfferJson,
    schemaId: GUARDIAN_SCHEMA_ID,
    credDefId: GUARDIAN_CRED_DEF_ID,
    issuerId: FAMILY_DID,
  })
})

credentialRoutes.post('/credential/issue', async (c) => {
  const body = await c.req.json<{
    credentialOfferJson: string
    credentialRequestJson: string
    attributes: Record<string, string>
  }>()
  const credentialJson = familyIssuer.issue(
    GUARDIAN_CRED_DEF_ID,
    body.credentialOfferJson,
    body.credentialRequestJson,
    body.attributes,
  )
  return c.json({ credentialJson })
})
