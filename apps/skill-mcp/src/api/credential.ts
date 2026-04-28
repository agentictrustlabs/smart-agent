import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import {
  skillIssuer,
  SKILL_ISSUER_DID,
  SKILLS_SCHEMA_ID,
  SKILLS_CRED_DEF_ID,
  SKILLS_SPEC,
  ensureSkillsRegistered,
} from '../issuers/skill.js'

export const credentialRoutes = new Hono()

/**
 * POST /credential/offer
 *
 * Body: { credentialType: 'SkillsCredential' }
 * Returns: { offerId, credentialOfferJson, schemaId, credDefId, issuerId }
 */
credentialRoutes.post('/credential/offer', async (c) => {
  const { credentialType } = await c.req.json<{ credentialType: string }>()
  if (credentialType !== 'SkillsCredential') {
    return c.json({ error: 'unsupported credentialType' }, 400)
  }
  await ensureSkillsRegistered()
  const credentialOfferJson = await skillIssuer.createOffer(SKILLS_CRED_DEF_ID)
  return c.json({
    offerId: `offer_${randomUUID()}`,
    credentialOfferJson,
    schemaId: SKILLS_SCHEMA_ID,
    credDefId: SKILLS_CRED_DEF_ID,
    issuerId: SKILL_ISSUER_DID,
  })
})

/**
 * POST /credential/issue
 *
 * Body: {
 *   credentialOfferJson, credentialRequestJson,
 *   attributes: { skillId, skillName, relation, proficiencyScore,
 *                 confidence, issuerName, issuerDid,
 *                 validFrom, validUntil, issuedAt },
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
  for (const name of SKILLS_SPEC.attributeNames) {
    if (!(name in body.attributes)) {
      return c.json({ error: `attribute "${name}" missing` }, 400)
    }
    if (typeof body.attributes[name] !== 'string') {
      return c.json({ error: `attribute "${name}" must be a string (AnonCreds requirement)` }, 400)
    }
  }
  const credentialJson = await skillIssuer.issue(
    SKILLS_CRED_DEF_ID,
    body.credentialOfferJson,
    body.credentialRequestJson,
    body.attributes,
  )
  return c.json({ credentialJson })
})
