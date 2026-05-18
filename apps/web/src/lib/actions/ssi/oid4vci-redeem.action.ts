'use server'

/**
 * Routing rule (phase 3 of A2A-first consolidation):
 *   - OID4VCI endpoints on org-mcp (`/oid4vci/offer-by-code`, `/token`,
 *     `/credential`) are PUBLIC PROTOCOL endpoints — they stay direct
 *     HTTP via the `org` client. OID4VCI is an unauthenticated
 *     standards surface; the holder's identity is established by the
 *     pre-authorized_code + AnonCreds blinding ceremony, not by a
 *     session token.
 *   - Person-mcp tool calls (`ssi_create_wallet_action`,
 *     `ssi_start_credential_exchange`, `ssi_finish_credential_exchange`,
 *     `ssi_get_holder_wallet`) route through `callMcp('person', …)` —
 *     signed-in user is the redeeming holder. Sprint 5 W3 P1-2: no
 *     direct GET on /wallet/<principal>/<context>.
 */

import { revalidatePath } from 'next/cache'
import type { WalletAction } from '@smart-agent/privacy-creds'
import { loadSignerForCurrentUser, signWalletAction } from '@/lib/ssi/signer'
import { org } from '@/lib/ssi/clients'
import { callMcp } from '@/lib/clients/mcp-client'
import { ssiConfig } from '@/lib/ssi/config'

export async function redeemOid4vciOfferAction(args: {
  input: string
  walletContext?: string
}): Promise<{ success: boolean; credentialId?: string; error?: string }> {
  try {
    const ctx = await loadSignerForCurrentUser()
    const { principal } = ctx
    void ctx

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

    // Walletize to the caller's current context (defaults to 'default').
    const walletContext = (args as { walletContext?: string }).walletContext ?? 'default'

    // Ensure wallet exists for this (principal, context).
    // Sprint 5 W3 P1-2: routed via ssi_get_holder_wallet (a2a→person hop
    // signed). Direct GET on /wallet/<principal>/<context> is no longer
    // accepted by person-mcp.
    let holderWalletId: string | undefined
    try {
      const r = await callMcp<{ found: boolean; holderWalletId?: string }>(
        'person',
        'ssi_get_holder_wallet',
        { principal, walletContext },
      )
      if (r.found) holderWalletId = r.holderWalletId
    } catch { /* fall through */ }
    if (!holderWalletId) {
      const { provisionHolderWalletAction } = await import('./provision.action')
      const p = await provisionHolderWalletAction(walletContext)
      if (!p.success || !p.holderWalletId) return { success: false, error: p.error ?? 'provision failed' }
      holderWalletId = p.holderWalletId
    }

    const built = await callMcp<{ action: WalletAction & { expiresAt: string } }>(
      'person',
      'ssi_create_wallet_action',
      {
        principal,
        walletContext,
        type: 'AcceptCredentialOffer',
        counterpartyId: freshOffer.issuerId,
        purpose: 'oid4vci redeem',
        credentialType: 'OrgMembershipCredential',
        holderWalletId,
      },
    )
    const action: WalletAction = { ...built.action, expiresAt: BigInt(built.action.expiresAt) }
    const { signature } = await signWalletAction(action)

    const req = await callMcp<{ requestId: string; credentialRequestJson: string }>(
      'person',
      'ssi_start_credential_exchange',
      {
        action: built.action, signature,
        credentialOfferJson: freshOffer.credentialOfferJson,
        credDefId: freshOffer.credDefId,
      },
    )

    const credRes = await org.oid4vciCredential(tok.access_token, freshOffer.credDefId, req.credentialRequestJson)

    const fin = await callMcp<{ credentialId: string }>(
      'person',
      'ssi_finish_credential_exchange',
      {
        principal,
        walletContext,
        holderWalletId,
        requestId: req.requestId,
        credentialJson: credRes.credential,
        credentialType: 'OrgMembershipCredential',
        issuerId: credRes.issuer_id,
        schemaId: credRes.schema_id,
      },
    )

    // Confirm ssiConfig contract address is available to suppress lint.
    void ssiConfig.verifierContract

    revalidatePath('/wallet')
    return { success: true, credentialId: fin.credentialId }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}
