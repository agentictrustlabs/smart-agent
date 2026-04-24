import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { AnonCreds } from '@smart-agent/privacy-creds'
import { gateExistingWalletAction } from '../auth/verify-privy-action.js'
import {
  getLinkSecret,
  putCredential,
  putCredentialRequestMeta,
  takeCredentialRequestMeta,
} from '../storage/askar.js'
import { insertCredentialMetadata, listCredentialMetadata } from '../storage/cred-metadata.js'
import { CredentialRegistryStore, loadVerifiedCredDef } from '@smart-agent/credential-registry'
import { config } from '../config.js'

export const credentialRoutes = new Hono()

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
  const registry = new CredentialRegistryStore(config.registryPath)
  try {
    let credDef
    try {
      credDef = await loadVerifiedCredDef(registry, body.credDefId)
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
  } finally {
    registry.close()
  }
})

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
 * AcceptCredentialOffer that started the exchange is the authorization. The
 * requestId is a one-shot token removed from Askar on use.
 */
credentialRoutes.post('/credentials/store', async (c) => {
  const body = await c.req.json<{
    holderWalletId: string
    requestId: string
    credentialJson: string
    credentialType: string
    issuerId: string
    schemaId: string
  }>()

  const { getHolderWalletById } = await import('../storage/wallets.js')
  const hw = getHolderWalletById(body.holderWalletId)
  if (!hw) return c.json({ error: 'holder wallet not found' }, 404)

  const registry = new CredentialRegistryStore(config.registryPath)
  try {
    const meta = JSON.parse(await takeCredentialRequestMeta(hw.askarProfile, body.requestId)) as {
      credentialRequestMetadata: string
      credDefId: string
    }
    let credDef
    try {
      credDef = await loadVerifiedCredDef(registry, meta.credDefId)
    } catch (err) {
      return c.json({ error: `credDef: ${(err as Error).message}` }, 403)
    }

    const linkSecret = await getLinkSecret(hw.askarProfile, hw.linkSecretId)

    const processed = AnonCreds.holderProcessCredential({
      credentialJson: body.credentialJson,
      credentialRequestMetadataJson: meta.credentialRequestMetadata,
      linkSecret,
      credentialDefinitionJson: credDef.json,
    })

    const credId = `cred_${randomUUID()}`
    await putCredential(hw.askarProfile, credId, processed, {
      credDefId: meta.credDefId,
      schemaId: body.schemaId,
      issuerId: body.issuerId,
    })

    const metaRow = insertCredentialMetadata({
      id: credId,
      holderWalletId: hw.id,
      issuerId: body.issuerId,
      schemaId: body.schemaId,
      credDefId: meta.credDefId,
      credentialType: body.credentialType,
    })

    return c.json({ credentialId: credId, metadata: metaRow })
  } finally {
    registry.close()
  }
})

/** GET /credentials/:holderWalletId — metadata only (no blobs, no attrs). */
credentialRoutes.get('/credentials/:holderWalletId', (c) => {
  const rows = listCredentialMetadata(c.req.param('holderWalletId'))
  return c.json({ credentials: rows })
})
