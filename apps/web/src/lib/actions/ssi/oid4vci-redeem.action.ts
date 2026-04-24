'use server'

import { revalidatePath } from 'next/cache'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { loadSignerForCurrentUser, signWalletAction } from '@/lib/ssi/signer'
import { person, org } from '@/lib/ssi/clients'
import { ssiConfig } from '@/lib/ssi/config'

export async function redeemOid4vciOfferAction(args: {
  /** Either the base64url-encoded credential_offer (`credential_offer_uri`) or just the pre_authorized_code. */
  input: string
}): Promise<{ success: boolean; credentialId?: string; error?: string }> {
  try {
    const { principal, userRow } = await loadSignerForCurrentUser()

    let preAuthCode: string
    try {
      const decoded = Buffer.from(args.input, 'base64url').toString('utf8')
      const parsed = JSON.parse(decoded) as {
        grants?: Record<string, { 'pre-authorized_code'?: string }>
        credential_offer?: { grants?: Record<string, { 'pre-authorized_code'?: string }> }
      }
      preAuthCode =
        parsed.credential_offer?.grants?.['urn:ietf:params:oauth:grant-type:pre-authorized_code']?.['pre-authorized_code']
        ?? parsed.grants?.['urn:ietf:params:oauth:grant-type:pre-authorized_code']?.['pre-authorized_code']
        ?? ''
      if (!preAuthCode) throw new Error('no pre-auth code in offer')
    } catch {
      preAuthCode = args.input.trim()
    }
    if (!/^pac_[0-9a-fA-F]+$/.test(preAuthCode)) {
      return { success: false, error: 'input is not a valid offer URI or pre-auth code (expected pac_...)' }
    }

    // Look up the AnonCreds offer body that was bound to this pre-auth code
    // at /oid4vci/offer time. The correctness proof is nonce-bound to the
    // exact offer used at /credential time, so we MUST use the same one —
    // NOT a fresh offer.
    const bound = await org.oid4vciOfferByCode(preAuthCode)
    const freshOffer = {
      credentialOfferJson: bound.anoncreds_credential_offer,
      credDefId: bound.credential_definition_id,
      schemaId: bound.schema_id,
      issuerId: bound.issuer_id,
    }

    // Exchange pre-auth code for access token.
    const tok = await org.oid4vciToken(preAuthCode)

    // Ensure wallet provisioned; get holderWalletId.
    const list = await person.callTool<{ credentials: Array<{ holderWalletRef: string }> }>(
      'ssi_list_my_credentials', { principal },
    ).catch(() => ({ credentials: [] }))
    let holderWalletId = list.credentials[0]?.holderWalletRef
    if (!holderWalletId) {
      const { provisionHolderWalletAction } = await import('./provision.action')
      const p = await provisionHolderWalletAction()
      if (!p.success || !p.holderWalletId) return { success: false, error: p.error ?? 'provision failed' }
      holderWalletId = p.holderWalletId
    }

    // Build AcceptCredentialOffer action.
    const built = await person.callTool<{ action: WalletAction & { expiresAt: string } }>(
      'ssi_create_wallet_action',
      {
        principal,
        type: 'AcceptCredentialOffer',
        counterpartyId: freshOffer.issuerId,
        purpose: 'oid4vci redeem',
        credentialType: 'OrgMembershipCredential',
        holderWalletId,
      },
    )
    const action: WalletAction = { ...built.action, expiresAt: BigInt(built.action.expiresAt) }
    const { signature } = await signWalletAction(action)

    // Wallet creates credential request against this offer.
    const req = await person.callTool<{ requestId: string; credentialRequestJson: string }>(
      'ssi_start_credential_exchange',
      {
        action: built.action, signature,
        credentialOfferJson: freshOffer.credentialOfferJson,
        credDefId: freshOffer.credDefId,
      },
    )

    // POST /credential with access_token.
    const credRes = await org.oid4vciCredential(tok.access_token, freshOffer.credDefId, req.credentialRequestJson)

    // Wallet stores.
    const fin = await person.callTool<{ credentialId: string }>(
      'ssi_finish_credential_exchange',
      {
        principal, holderWalletId, requestId: req.requestId,
        credentialJson: credRes.credential,
        credentialType: 'OrgMembershipCredential',
        issuerId: credRes.issuer_id,
        schemaId: credRes.schema_id,
      },
    )

    // Confirm ssiConfig contract address is available to suppress lint.
    void ssiConfig.verifierContract
    void userRow.walletAddress

    revalidatePath('/wallet')
    return { success: true, credentialId: fin.credentialId }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
