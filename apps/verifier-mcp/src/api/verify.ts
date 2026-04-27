import { Hono } from 'hono'
import { privateKeyToAccount } from 'viem/accounts'
import { signPresentationRequest } from '@smart-agent/privacy-creds'
import { OnChainResolver } from '@smart-agent/credential-registry'
import { config } from '../config.js'
import { getSpec, listSpecs, verifyPresentationForSpec, type VerifierSpec } from '../verifiers/specs.js'
import { consumeNonce } from '../verifiers/nonce-store.js'

export const verifyRoutes = new Hono()

const verifierAccount = privateKeyToAccount(config.privateKey)

const VERIFIER_DID = `did:ethr:${config.chainId}:${verifierAccount.address.toLowerCase()}`

const resolver = new OnChainResolver({
  rpcUrl: config.rpcUrl,
  chainId: config.chainId,
  contractAddress: config.credentialRegistryAddress,
})

export function getVerifierIdentity() {
  return {
    did: VERIFIER_DID,
    address: verifierAccount.address,
    displayName: config.displayName,
  }
}

/**
 * POST /verify/{credentialType}/request
 *
 * Returns a signed presentation_request the holder wallet can ingest, plus
 * verifier identity bytes the wallet checks against its known-verifier list.
 *
 * The request body shape (selection referents) is included so the web app
 * doesn't need to keep a parallel copy of which referents to reveal.
 */
verifyRoutes.post('/verify/:credentialType/request', async (c) => {
  const credentialType = c.req.param('credentialType')
  const spec = lookupSpec(credentialType)
  if (!spec) return c.json({ error: 'unsupported credential type' }, 400)

  const presentationRequest = spec.buildRequest()
  const signature = await signPresentationRequest(verifierAccount, presentationRequest)
  return c.json({
    presentationRequest,
    selection: spec.selection,
    verifierId:      VERIFIER_DID,
    verifierAddress: verifierAccount.address,
    signature,
    label:           spec.label,
  })
})

/**
 * POST /verify/{credentialType}/check
 *
 * Body: { presentation, presentationRequest }
 *
 * Off-chain: verifies AnonCreds proof, consumes nonce so the same presentation
 * can't be replayed against this verifier-mcp instance, returns
 * `{ verified, reason?, replay?, revealedAttrs? }`.
 *
 * The verifier never re-checks the on-chain claim — that's a separate
 * trust signal. AnonCreds verification alone proves the credential is
 * issued by an issuer the resolver knows about and the holder controls
 * the link secret it's bound to.
 */
verifyRoutes.post('/verify/:credentialType/check', async (c) => {
  const credentialType = c.req.param('credentialType')
  const spec = lookupSpec(credentialType)
  if (!spec) return c.json({ error: 'unsupported credential type' }, 400)

  const body = await c.req.json<{
    presentation: string
    presentationRequest: Record<string, unknown> & { nonce?: string; name?: string }
  }>()
  const requestNonce = (body.presentationRequest.nonce as string | undefined) ?? ''
  try {
    consumeNonce(requestNonce, body.presentationRequest.name as string | undefined)
  } catch (err) {
    return c.json({ verified: false, reason: (err as Error).message, replay: true }, 409)
  }

  const result = await verifyPresentationForSpec(
    resolver,
    spec,
    body.presentation,
    body.presentationRequest,
  )
  if (!result.verified) {
    return c.json({ verified: false, reason: result.reason ?? 'verify failed' }, 400)
  }

  // Surface revealed attrs back to the caller so the test UI can show what
  // the verifier actually saw. The presentation is the source of truth;
  // we extract the requested_proof.revealed_attrs map for clarity.
  const revealed = extractRevealed(body.presentation)
  return c.json({ verified: true, revealedAttrs: revealed })
})

verifyRoutes.get('/verify/specs', (c) => {
  return c.json({
    verifierId: VERIFIER_DID,
    verifierAddress: verifierAccount.address,
    specs: listSpecs().map(s => ({
      credentialType: s.credentialType,
      schemaId:       s.schemaId,
      credDefId:      s.credDefId,
      label:          s.label,
    })),
  })
})

function lookupSpec(credentialType: string): VerifierSpec | null {
  // URL-friendly aliases: GeoLocationCredential ↔ geo-location ↔ geo, etc.
  const direct = getSpec(credentialType)
  if (direct) return direct
  const normalized = credentialType.toLowerCase().replace(/-/g, '')
  for (const s of listSpecs()) {
    const key = s.credentialType.toLowerCase().replace(/credential$/, '')
    if (key === normalized) return s
  }
  return null
}

function extractRevealed(presentationJson: string): Record<string, string> {
  try {
    const j = JSON.parse(presentationJson) as {
      requested_proof?: { revealed_attrs?: Record<string, { raw?: string }> }
    }
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(j.requested_proof?.revealed_attrs ?? {})) {
      if (v && typeof v.raw === 'string') out[k] = v.raw
    }
    return out
  } catch {
    return {}
  }
}
