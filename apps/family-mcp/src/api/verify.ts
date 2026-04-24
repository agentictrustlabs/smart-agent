import { Hono } from 'hono'
import { privateKeyToAccount } from 'viem/accounts'
import { signPresentationRequest } from '@smart-agent/privacy-creds'
import { OnChainResolver } from '@smart-agent/credential-registry'
import { config } from '../config.js'
import { buildGuardianProofRequest, verifyGuardianPresentation } from '../verifiers/guardian.js'
import { consumeNonce } from '../verifiers/nonce-store.js'
import { FAMILY_DID } from '../issuers/guardian.js'

export const verifyRoutes = new Hono()

const familyAccount = privateKeyToAccount(config.privateKey)

// A verifier needs ONLY an RPC URL + the registry contract address to
// resolve schemas/credDefs. It does NOT need the issuer's DB.
const resolver = new OnChainResolver({
  rpcUrl: config.rpcUrl,
  chainId: config.chainId,
  contractAddress: config.credentialRegistryAddress,
})

verifyRoutes.get('/verify/guardian/request', async (c) => {
  const presentationRequest = buildGuardianProofRequest()
  // Sign the request so the wallet can reject unsigned / unknown verifiers.
  const signature = await signPresentationRequest(familyAccount, presentationRequest)
  return c.json({
    presentationRequest,
    verifierId:       FAMILY_DID,
    verifierAddress:  familyAccount.address,
    signature,
  })
})

verifyRoutes.post('/verify/guardian/check', async (c) => {
  const body = await c.req.json<{
    presentation: string
    presentationRequest: Record<string, unknown> & { nonce?: string; name?: string }
  }>()
  try {
    const requestNonce = (body.presentationRequest.nonce as string | undefined) ?? ''
    try {
      consumeNonce(requestNonce, body.presentationRequest.name as string | undefined)
    } catch (err) {
      return c.json({ verified: false, reason: (err as Error).message, replay: true }, 409)
    }

    const ok = await verifyGuardianPresentation(
      resolver,
      body.presentation,
      body.presentationRequest,
    )
    return c.json({ verified: ok })
  } catch (err) {
    return c.json({ verified: false, reason: (err as Error).message }, 400)
  }
})
