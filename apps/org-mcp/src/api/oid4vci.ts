/**
 * OID4VCI adapter for org-mcp (Phase 5).
 *
 * Pre-authorized-code flow only — no user-facing authorization server.
 * The wallet receives a credential_offer containing a pre-authorized_code,
 * exchanges it for a short-lived access token at /token, then fetches the
 * credential at /credential.
 *
 * The credential `format` is our private `anoncreds-v1`; the binding is the
 * shape of the body (credential_offer_json ↔ AnonCreds offer, etc.). Real
 * OID4VCI-AnonCreds draft exists; this is MVP-compatible with it.
 */

import { Hono } from 'hono'
import { randomBytes, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import {
  catalystIssuer,
  CATALYST_DID,
  MEMBERSHIP_SCHEMA_ID,
  MEMBERSHIP_CRED_DEF_ID,
  ensureMembershipRegistered,
} from '../issuers/membership.js'
import { config } from '../config.js'

export const oid4vciRoutes = new Hono()

// Pre-auth state persisted to disk so codes survive org-mcp restarts.
const OID_DB_PATH = process.env.OID4VCI_DB_PATH ?? './oid4vci.db'
const oidDb = new Database(OID_DB_PATH)
oidDb.pragma('journal_mode = WAL')
oidDb.exec(`
  CREATE TABLE IF NOT EXISTS pre_auth (
    code TEXT PRIMARY KEY,
    credential_offer_json TEXT NOT NULL,
    attributes_json TEXT NOT NULL,
    access_token TEXT,
    expires_at INTEGER NOT NULL
  );
`)

// ─── Static metadata ────────────────────────────────────────────────────────

oid4vciRoutes.get('/.well-known/openid-credential-issuer', (c) => {
  return c.json({
    credential_issuer: config.issuerBaseUrl,
    token_endpoint: `${config.issuerBaseUrl}/token`,
    credential_endpoint: `${config.issuerBaseUrl}/credential`,
    display: [{ name: config.displayName, locale: 'en' }],
    credential_configurations_supported: {
      OrgMembershipCredential: {
        format: 'anoncreds-v1',
        scope: 'OrgMembership',
        cryptographic_binding_methods_supported: ['did:ethr'],
        credential_definition: {
          schemaId: MEMBERSHIP_SCHEMA_ID,
          credDefId: MEMBERSHIP_CRED_DEF_ID,
          issuerId: CATALYST_DID,
        },
        claims: {
          membershipStatus: { value_type: 'string' },
          role: { value_type: 'string' },
          joinedYear: { value_type: 'string' },
          circleId: { value_type: 'string' },
        },
      },
    },
  })
})

// ─── Initiate: create a credential offer with pre-auth code ─────────────────

/**
 * POST /oid4vci/offer
 *
 * Body: { attributes: { membershipStatus, role, joinedYear, circleId } }
 * Returns: { credential_offer, credential_offer_uri (base64url), pre_authorized_code }
 *
 * In a full deployment this comes from an issuer UI. For MVP/test, a POST with
 * the attributes is enough — the mock "org admin" role.
 */
oid4vciRoutes.post('/oid4vci/offer', async (c) => {
  const { attributes } = await c.req.json<{ attributes: Record<string, string> }>()
  await ensureMembershipRegistered()
  const credentialOfferJson = catalystIssuer.createOffer(MEMBERSHIP_CRED_DEF_ID)
  const code = 'pac_' + randomBytes(24).toString('hex')
  oidDb.prepare(
    `INSERT INTO pre_auth (code, credential_offer_json, attributes_json, expires_at)
     VALUES (?, ?, ?, ?)`,
  ).run(code, credentialOfferJson, JSON.stringify(attributes), Math.floor(Date.now() / 1000) + 600)

  const offer = {
    credential_issuer: config.issuerBaseUrl,
    credential_configuration_ids: ['OrgMembershipCredential'],
    grants: {
      'urn:ietf:params:oauth:grant-type:pre-authorized_code': {
        'pre-authorized_code': code,
      },
    },
  }
  const offer_uri = Buffer.from(JSON.stringify(offer), 'utf8').toString('base64url')
  return c.json({
    credential_offer: offer,
    credential_offer_uri: offer_uri,
    pre_authorized_code: code,
    // anoncreds-specific extension: expose the on-the-wire AnonCreds offer so
    // the wallet uses the exact offer bound to this pre-auth code.
    anoncreds_credential_offer: credentialOfferJson,
    credential_definition_id: MEMBERSHIP_CRED_DEF_ID,
    schema_id: MEMBERSHIP_SCHEMA_ID,
    issuer_id: CATALYST_DID,
  })
})

/**
 * GET /oid4vci/offer-by-code/:code
 *
 * Returns the AnonCreds offer body that was bound to a pre-authorized_code at
 * /oid4vci/offer time. The wallet needs THIS exact offer — not a fresh one —
 * because the credential-request correctness proof is nonce-bound.
 *
 * No auth: the code itself is the capability. Records beyond the 10-min TTL
 * are refused.
 */
oid4vciRoutes.get('/oid4vci/offer-by-code/:code', async (c) => {
  const code = c.req.param('code')
  const row = oidDb.prepare(`SELECT * FROM pre_auth WHERE code = ?`).get(code) as
    | { credential_offer_json: string; expires_at: number }
    | undefined
  if (!row) return c.json({ error: 'not found' }, 404)
  if (row.expires_at < Math.floor(Date.now() / 1000)) return c.json({ error: 'expired' }, 410)
  return c.json({
    anoncreds_credential_offer: row.credential_offer_json,
    credential_definition_id: MEMBERSHIP_CRED_DEF_ID,
    schema_id: MEMBERSHIP_SCHEMA_ID,
    issuer_id: CATALYST_DID,
  })
})

// ─── /token ─────────────────────────────────────────────────────────────────

oid4vciRoutes.post('/token', async (c) => {
  const body = (c.req.header('content-type') ?? '').includes('application/x-www-form-urlencoded')
    ? Object.fromEntries(new URLSearchParams(await c.req.text()))
    : await c.req.json<Record<string, string>>()
  if (body.grant_type !== 'urn:ietf:params:oauth:grant-type:pre-authorized_code') {
    return c.json({ error: 'unsupported_grant_type' }, 400)
  }
  const code = body['pre-authorized_code']
  if (!code) return c.json({ error: 'invalid_grant' }, 400)
  const row = oidDb.prepare(`SELECT * FROM pre_auth WHERE code = ?`).get(code) as
    | { code: string; credential_offer_json: string; attributes_json: string; access_token: string | null; expires_at: number }
    | undefined
  if (!row) return c.json({ error: 'invalid_grant' }, 400)
  if (row.expires_at < Math.floor(Date.now() / 1000)) return c.json({ error: 'invalid_grant', desc: 'expired' }, 400)

  const access_token = 'at_' + randomBytes(32).toString('hex')
  oidDb.prepare(`UPDATE pre_auth SET access_token = ? WHERE code = ?`).run(access_token, code)

  return c.json({
    access_token,
    token_type: 'Bearer',
    expires_in: 300,
    c_nonce: randomUUID(),
    c_nonce_expires_in: 300,
  })
})

// ─── /credential ───────────────────────────────────────────────────────────

/**
 * The wallet calls this with:
 *   Authorization: Bearer <access_token>
 *   body: {
 *     format: "anoncreds-v1",
 *     credential_definition: { credDefId },
 *     anoncreds_credential_request: <wallet's credential request JSON>
 *   }
 */
oid4vciRoutes.post('/credential', async (c) => {
  const auth = c.req.header('authorization') ?? ''
  const at = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!at) return c.json({ error: 'invalid_token' }, 401)
  const row = oidDb.prepare(`SELECT * FROM pre_auth WHERE access_token = ?`).get(at) as
    | { code: string; credential_offer_json: string; attributes_json: string; access_token: string | null; expires_at: number }
    | undefined
  if (!row) return c.json({ error: 'invalid_token' }, 401)
  if (row.expires_at < Math.floor(Date.now() / 1000)) return c.json({ error: 'invalid_token', desc: 'expired' }, 401)

  const body = await c.req.json<{
    format: string
    anoncreds_credential_request: string
  }>()
  if (body.format !== 'anoncreds-v1') {
    return c.json({ error: 'unsupported_format' }, 400)
  }

  const attrs = JSON.parse(row.attributes_json) as Record<string, string>
  const credentialJson = catalystIssuer.issue(
    MEMBERSHIP_CRED_DEF_ID,
    row.credential_offer_json,
    body.anoncreds_credential_request,
    attrs,
  )

  // One-shot: delete the pre-auth record on successful delivery.
  oidDb.prepare(`DELETE FROM pre_auth WHERE access_token = ?`).run(at)

  return c.json({
    format: 'anoncreds-v1',
    credential: credentialJson,
    credential_offer_json: row.credential_offer_json,
    schema_id: MEMBERSHIP_SCHEMA_ID,
    credential_definition_id: MEMBERSHIP_CRED_DEF_ID,
    issuer_id: CATALYST_DID,
  })
})
