import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { AnonCreds } from '@smart-agent/privacy-creds'
import { gateExistingWalletAction } from '../auth/verify-wallet-action.js'
import {
  getLinkSecret,
  putCredential,
  putCredentialRequestMeta,
  takeCredentialRequestMeta,
} from '../storage/askar.js'
import { insertCredentialMetadata, listCredentialMetadata } from '../storage/cred-metadata.js'
import { loadVerifiedCredDef } from '@smart-agent/credential-registry'
import { resolver } from '../registry/resolver.js'
import { requireInboundServiceAuth } from '../../auth/require-inbound-service-auth.js'

export const credentialRoutes = new Hono()

// Sprint 5 W3 P1-2 — wire-auth gate for the SSI credential routes.
// `/credentials/:holderWalletId` (GET) is a credential-metadata listing
// keyed by holder wallet — high PII risk. `/credentials/store` (POST)
// accepts processed credential blobs; the one-shot `requestId` is the
// issuer-side authorisation, but the wire hop must also be a known
// service (only `a2a-agent` is allowed inbound).
const ssiInboundAuth = requireInboundServiceAuth()

/**
 * POST /credentials/request
 *
 * Holder builds a credential request bound to the link secret and returns it
 * to the issuer. The blinding metadata is stored in Askar (category
 * credential_request) keyed by requestId so /credentials/store can complete.
 *
 * Body: {
 *   action, signature,
 *   credentialOfferJson,
 *   credDefId                 // used to look up creddef JSON in registry
 * }
 * Returns: { requestId, credentialRequestJson }
 *
 * @sa-route delegation-verified
 * @sa-auth wallet-action-signature
 * @sa-rate-limit none
 * @sa-prod-gate always
 * @sa-validation wallet-action-canonical
 * @sa-risk-tier sensitive
 * @sa-owner security
 */
credentialRoutes.post('/credentials/request', async (c) => {
  const body = await c.req.json<{
    action: WalletAction & { expiresAt: string | number | bigint }
    signature: `0x${string}`
    credentialOfferJson: string
    credDefId: string
  }>()

  const action: WalletAction = { ...body.action, expiresAt: BigInt(body.action.expiresAt) }
  if (action.type !== 'AcceptCredentialOffer') {
    return c.json({ error: `unexpected action type: ${action.type}` }, 400)
  }

  const gate = await gateExistingWalletAction({ action, signature: body.signature })
  if (!gate.ok) return c.json({ error: gate.reason }, gate.status as 400 | 401 | 404 | 409)

  const hw = gate.holderWallet
  let credDef
  try {
    credDef = await loadVerifiedCredDef(resolver, body.credDefId)
  } catch (err) {
    return c.json({ error: `credDef: ${(err as Error).message}` }, 403)
  }

  const linkSecret = await getLinkSecret(hw.askarProfile, hw.linkSecretId)

  const { credentialRequest, credentialRequestMetadata } = AnonCreds.holderCreateCredentialRequest({
    credentialOfferJson: body.credentialOfferJson,
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
      credDefId: body.credDefId,
      credentialOfferJson: body.credentialOfferJson,
    }),
  )

  return c.json({ requestId, credentialRequestJson: credentialRequest })
})

export interface StoreCredentialInput {
  holderWalletId: string
  requestId: string
  credentialJson: string
  credentialType: string
  issuerId: string
  schemaId: string
  /** Smart-account address of the org this credential references — e.g.
   *  the Red Feather Circle agent for an OrgMembership in that circle.
   *  Optional for older callers that don't yet set it. */
  targetOrgAddress?: string
  /** Spec 004 (b2) — admin→holder on-chain delegation signed at
   *  credential-issuance time. Carried alongside the AnonCred so the
   *  action layer can rebuild the redeem chain. Both fields are
   *  optional for non-marketplace credentials. */
  adminDelegationJson?: string
  adminDelegationTarget?: string
}

export type StoreCredentialResult =
  | { ok: true; credentialId: string; metadata: unknown }
  | { ok: false; status: 403 | 404; error: string }

/**
 * Internal store-credential implementation. Shared between the HTTP
 * route (`POST /credentials/store`) and the MCP tool
 * (`ssi_finish_credential_exchange`) so the tool can drive the same
 * persistence path without a HTTP loopback (which would otherwise
 * require self-signing the wire-auth envelope, Sprint 5 W3 P1-2).
 */
export async function storeCredentialInternal(
  input: StoreCredentialInput,
): Promise<StoreCredentialResult> {
  const { getHolderWalletById } = await import('../storage/wallets.js')
  const hw = getHolderWalletById(input.holderWalletId)
  if (!hw) return { ok: false, status: 404, error: 'holder wallet not found' }

  const meta = JSON.parse(await takeCredentialRequestMeta(hw.askarProfile, input.requestId)) as {
    credentialRequestMetadata: string
    credDefId: string
  }
  let credDef
  try {
    credDef = await loadVerifiedCredDef(resolver, meta.credDefId)
  } catch (err) {
    return { ok: false, status: 403, error: `credDef: ${(err as Error).message}` }
  }

  const linkSecret = await getLinkSecret(hw.askarProfile, hw.linkSecretId)

  const processed = AnonCreds.holderProcessCredential({
    credentialJson: input.credentialJson,
    credentialRequestMetadataJson: meta.credentialRequestMetadata,
    linkSecret,
    credentialDefinitionJson: credDef.json,
  })

  const credId = `cred_${randomUUID()}`
  await putCredential(hw.askarProfile, credId, processed, {
    credDefId: meta.credDefId,
    schemaId: input.schemaId,
    issuerId: input.issuerId,
  })

  const metaRow = insertCredentialMetadata({
    id: credId,
    holderWalletId: hw.id,
    issuerId: input.issuerId,
    schemaId: input.schemaId,
    credDefId: meta.credDefId,
    credentialType: input.credentialType,
    linkSecretId: hw.linkSecretId,
    targetOrgAddress: input.targetOrgAddress?.toLowerCase() ?? null,
    adminDelegationJson: input.adminDelegationJson ?? null,
    adminDelegationTarget: input.adminDelegationTarget?.toLowerCase() ?? null,
  })

  return { ok: true, credentialId: credId, metadata: metaRow }
}

/**
 * POST /credentials/store
 *
 * Called by the issuer (or the issuer's relay) when the credential is ready.
 * The holder finishes processing against the stored request metadata and
 * stores the completed credential in Askar. Metadata surfaces locally.
 *
 * Body: {
 *   holderWalletId, requestId,
 *   credentialJson,
 *   credentialType,     // display type e.g. "OrgMembershipCredential"
 *   issuerId, schemaId  // for the metadata row
 * }
 *
 * Note: this endpoint does NOT require a new signed WalletAction — the signed
 * AcceptCredentialOffer that started the exchange is the issuer-side
 * authorisation. The requestId is a one-shot token removed from Askar on use.
 *
 * Sprint 5 W3 P1-2: now ALSO requires the `a2a-to-person` HMAC envelope
 * on the wire. The one-shot requestId is the application-layer
 * authorisation; the wire envelope authenticates the SERVICE making the
 * call (only `a2a-agent` is allowed). Issuers must therefore route
 * /credentials/store through a2a-agent rather than calling person-mcp
 * directly.
 *
 * @sa-route service-only
 * @sa-auth service-hmac
 * @sa-rate-limit none
 * @sa-prod-gate always
 * @sa-validation shape-check
 * @sa-risk-tier high
 * @sa-owner security
 */
credentialRoutes.post('/credentials/store', ssiInboundAuth, async (c) => {
  const body = await c.req.json<StoreCredentialInput>()
  const result = await storeCredentialInternal(body)
  if (!result.ok) return c.json({ error: result.error }, result.status)
  return c.json({ credentialId: result.credentialId, metadata: result.metadata })
})

/**
 * GET /credentials/:holderWalletId — metadata only (no blobs, no attrs).
 *
 * Sprint 5 W3 P1-2: now requires the `a2a-to-person` HMAC envelope.
 * Listing credentials for a holder wallet is high-risk PII (issuer,
 * credential type, timestamps), so unauthenticated access is no longer
 * permitted.
 *
 * @sa-route service-only
 * @sa-auth service-hmac
 * @sa-rate-limit none
 * @sa-prod-gate always
 * @sa-validation none-path-params
 * @sa-risk-tier high
 * @sa-owner security
 */
credentialRoutes.get('/credentials/:holderWalletId', ssiInboundAuth, (c) => {
  const rows = listCredentialMetadata(c.req.param('holderWalletId'))
  return c.json({ credentials: rows })
})
